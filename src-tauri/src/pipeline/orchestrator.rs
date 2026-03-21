use crate::db;
use crate::models::document::DocumentStatusChangedEvent;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;

#[derive(Error, Debug)]
#[allow(clippy::enum_variant_names)]
pub enum OrchestratorError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
    #[error("PDF parsing error: {0}")]
    PdfParserError(#[from] super::pdf_parser::PdfParserError),
    #[error("Chunking error: {0}")]
    ChunkerError(#[from] super::chunker::ChunkerError),
    #[error("Embedding error: {0}")]
    EmbedderError(#[from] super::embedder::EmbedderError),
    #[error("Configuration error: {0}")]
    ConfigError(String),
}

/// Resolve the path to the bundled nomic-embed-text tokenizer.json.
/// Mirrors the pattern used by `resolve_embed_model_path` in `llama_server.rs`.
fn resolve_tokenizer_path(app_handle: &AppHandle) -> Result<PathBuf, OrchestratorError> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| OrchestratorError::ConfigError(format!("Failed to get resource dir: {e}")))?;

    let tokenizer_path = resource_dir
        .join("resources")
        .join("models")
        .join("tokenizer.json");

    if !tokenizer_path.exists() {
        // Dev mode fallback: read directly from the source tree
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("models")
            .join("tokenizer.json");
        if dev_path.exists() {
            return Ok(dev_path);
        }
        return Err(OrchestratorError::ConfigError(
            "nomic-embed tokenizer.json not found (run `cargo build` to download it)".to_string(),
        ));
    }

    Ok(tokenizer_path)
}

/// Update document status in database
async fn update_document_status(
    db: &SqlitePool,
    app_handle: &AppHandle,
    document_id: &str,
    status: &str,
    error_details: Option<&str>,
) -> Result<(), OrchestratorError> {
    let error_json = error_details.map(|e| serde_json::json!({"error": e}).to_string());
    let updated_at = chrono::Utc::now().to_rfc3339();

    sqlx::query("UPDATE documents SET status = ?, error_details = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(error_json.clone())
        .bind(updated_at.clone())
        .bind(document_id)
        .execute(db)
        .await?;

    let _ = app_handle.emit(
        "document-status-changed",
        DocumentStatusChangedEvent {
            document_id: document_id.to_string(),
            status: status.to_string(),
            error_details: error_json,
            updated_at,
        },
    );

    Ok(())
}

/// Main orchestrator for PDF processing pipeline
/// 1. Update status: pending_processing → parsing
/// 2. Extract pages from PDF
/// 3. Save pages to database
/// 4. Update status: parsing → processing
/// 5. Chunk pages
/// 6. Save chunks to database
/// 7. Generate embeddings
/// 8. Save embeddings to database
/// 9. Update status: processing → complete
/// 10. Send notification
pub async fn process_document(
    db: &SqlitePool,
    document_id: &str,
    file_path: &str,
    app_data_dir: &Path,
    app_handle: AppHandle,
) -> Result<(), OrchestratorError> {
    log::info!("Starting processing for document {}", document_id);

    // Step 1: Update status to parsing
    update_document_status(db, &app_handle, document_id, "parsing", None).await?;

    // Step 2: Extract pages from PDF
    log::info!("Extracting pages from PDF: {}", file_path);
    let file_path_owned = file_path.to_string();
    let document_id_owned = document_id.to_string();
    let app_data_dir_owned = app_data_dir.to_path_buf();
    let app_handle_for_extract = app_handle.clone();

    let pages = tokio::task::spawn_blocking(move || {
        super::pdf_parser::extract_pages(
            &file_path_owned,
            &document_id_owned,
            &app_data_dir_owned,
            &app_handle_for_extract,
        )
    })
    .await
    .unwrap_or_else(|join_err| {
        Err(super::pdf_parser::PdfParserError::ExtractionError(format!(
            "PDF extraction panicked: {join_err}"
        )))
    })?;
    let page_count = pages.len() as i32;
    log::info!("Extracted {} pages", page_count);

    if pages.is_empty() {
        update_document_status(
            db,
            &app_handle,
            document_id,
            "failed",
            Some("No text extracted from PDF"),
        )
        .await?;
        return Err(OrchestratorError::ConfigError(
            "No text extracted from PDF".to_string(),
        ));
    }

    // Step 3: Save pages to database
    let pages_for_db: Vec<(i64, String, String)> = pages
        .iter()
        .map(|p| (p.page_number, p.raw_text.clone(), p.screenshot_path.clone()))
        .collect();
    db::embedding::save_pages(db, document_id, &pages_for_db).await?;

    // Update total_pages count
    sqlx::query("UPDATE documents SET total_pages = ? WHERE id = ?")
        .bind(page_count)
        .bind(document_id)
        .execute(db)
        .await?;

    // Step 4: Update status to processing (chunking + embedding)
    update_document_status(db, &app_handle, document_id, "processing", None).await?;

    // Step 5: Chunk pages
    log::info!("Chunking pages for document {}", document_id);

    let tokenizer_path = resolve_tokenizer_path(&app_handle)?;
    let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path).map_err(|e| {
        OrchestratorError::ConfigError(format!("Failed to load nomic-embed tokenizer: {e}"))
    })?;

    // Chunker only needs page_number and raw_text
    let pages_for_chunking: Vec<(i64, String)> = pages
        .iter()
        .map(|p| (p.page_number, p.raw_text.clone()))
        .collect();
    let chunked_pages = super::chunker::chunk_pages(&pages_for_chunking, &tokenizer)?;

    // Step 6: Save chunks and collect chunk metadata for embedding
    let mut all_chunks_for_embedding = Vec::new();

    for chunked_page in &chunked_pages {
        // First get page_id from database
        let page_id: (String,) =
            sqlx::query_as("SELECT id FROM pages WHERE document_id = ? AND page_number = ?")
                .bind(document_id)
                .bind(chunked_page.page_number)
                .fetch_one(db)
                .await?;

        let page_id_str = page_id.0;

        // Prepare chunks for database
        let chunks_for_db: Vec<(String, i64, i64, String, i64)> = chunked_page
            .chunks
            .iter()
            .map(|c| {
                (
                    page_id_str.clone(),
                    chunked_page.page_number,
                    c.chunk_index,
                    c.text.clone(),
                    c.token_count,
                )
            })
            .collect();

        let chunk_ids = db::embedding::save_chunks(db, document_id, &chunks_for_db).await?;

        // Collect for embedding generation
        for (i, chunk) in chunked_page.chunks.iter().enumerate() {
            all_chunks_for_embedding.push((
                chunk_ids[i].clone(),
                chunk.text.clone(),
                chunked_page.page_number,
            ));
        }
    }

    log::info!(
        "Saved {} chunks for document {}",
        all_chunks_for_embedding.len(),
        document_id
    );

    // Step 7: Generate embeddings
    log::info!(
        "Generating embeddings for {} chunks",
        all_chunks_for_embedding.len()
    );

    let embeddings_data: Vec<(String, String, i64)> = all_chunks_for_embedding
        .iter()
        .map(|(id, text, page_num)| (id.clone(), text.clone(), *page_num))
        .collect();

    let embeddings = super::embedder::generate_embeddings(&embeddings_data).await?;

    // Step 8: Save embeddings
    log::info!("Saving {} embeddings", embeddings.len());

    // Get page_ids for each chunk
    let mut embeddings_for_db = Vec::new();
    for emb in embeddings {
        let page_id: (String,) = sqlx::query_as("SELECT page_id FROM chunks WHERE id = ?")
            .bind(&emb.chunk_id)
            .fetch_one(db)
            .await?;

        embeddings_for_db.push((emb.chunk_id, page_id.0, emb.page_number, emb.vector));
    }

    db::embedding::save_embeddings(db, &embeddings_for_db, "nomic-embed-text-v1.5").await?;

    // Tag the document with the embedding model used
    sqlx::query("UPDATE documents SET embedding_model = 'nomic-embed-text-v1.5' WHERE id = ?")
        .bind(document_id)
        .execute(db)
        .await?;

    // Step 9: Mark as complete
    update_document_status(db, &app_handle, document_id, "complete", None).await?;

    sqlx::query(
        "UPDATE documents SET embeddings_complete = 1, completed_at = datetime('now') WHERE id = ?",
    )
    .bind(document_id)
    .execute(db)
    .await?;

    log::info!("Processing complete for document {}", document_id);

    // Step 10: Send notification (optional - requires tauri-plugin-notification)
    // For now, just log completion
    log::info!("Document {} ready for chat", document_id);

    // Could send Tauri event to frontend
    let _ = app_handle.emit("processing-complete", document_id);

    Ok(())
}
