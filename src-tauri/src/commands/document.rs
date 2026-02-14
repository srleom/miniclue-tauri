use specta::Type;
use tauri::{Emitter, State};

use crate::db;
use crate::error::ApiError;
use crate::models::document::{
    DocumentResponse, DocumentStatus, DocumentStatusChangedEvent, DocumentUpdate,
};
use crate::pipeline;
use crate::state::AppState;
use crate::validation;
use std::path::{Path, PathBuf};

/// Validates a file path to prevent directory traversal attacks
/// Returns canonicalized path if valid, error otherwise
fn validate_user_file_path(file_path: &str) -> Result<PathBuf, ApiError> {
    let path = Path::new(file_path);

    // Check file exists first
    if !path.exists() {
        return Err(ApiError::file_error(format!(
            "File not found: {}",
            file_path
        )));
    }

    // Canonicalize to resolve symlinks and .. sequences
    let canonical_path = path
        .canonicalize()
        .map_err(|e| ApiError::file_error(format!("Invalid file path: {}", e)))?;

    // Check for suspicious patterns (additional safety check)
    let path_str = canonical_path.to_string_lossy();
    if path_str.contains("..") {
        return Err(ApiError::file_error("Directory traversal detected in path"));
    }

    // Verify it's a file, not a directory
    if !canonical_path.is_file() {
        return Err(ApiError::file_error("Path must be a file, not a directory"));
    }

    Ok(canonical_path)
}

#[tauri::command]
#[specta::specta]
pub async fn get_documents(
    state: State<'_, AppState>,
    folder_id: String,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Vec<DocumentResponse>, ApiError> {
    let limit = limit.unwrap_or(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let documents =
        db::document::get_documents_by_folder(&state.db, &folder_id, limit, offset).await?;

    Ok(documents.into_iter().map(|d| d.into()).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn get_document(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DocumentResponse, ApiError> {
    let document = db::document::get_document(&state.db, &document_id).await?;

    Ok(document.into())
}

#[tauri::command]
#[specta::specta]
pub async fn update_document(
    state: State<'_, AppState>,
    document_id: String,
    data: DocumentUpdate,
) -> Result<DocumentResponse, ApiError> {
    // Validate title if provided
    if let Some(ref title) = data.title {
        validation::validate_title(title)?;
    }

    let document = db::document::update_document(
        &state.db,
        &document_id,
        data.title.as_deref(),
        data.folder_id.as_deref(),
        data.accessed_at.as_deref(),
    )
    .await?;

    Ok(document.into())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_document(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<(), ApiError> {
    // Delete from database (cascade deletes related data)
    db::document::delete_document(&state.db, &document_id).await?;

    // Delete document directory and all its contents (original.pdf + processing artifacts)
    let document_dir = state.app_data_dir.join("documents").join(&document_id);

    if document_dir.exists() {
        // Safety check: ensure the path is within app_data_dir
        // We construct the path ourselves, so this should always pass
        if !document_dir.starts_with(&state.app_data_dir) {
            log::error!(
                "Security violation: document directory is outside app data: {}",
                document_dir.display()
            );
            return Err(ApiError::internal_error("Invalid document path"));
        }

        if let Err(e) = std::fs::remove_dir_all(&document_dir) {
            log::warn!(
                "Failed to delete document directory {}: {}",
                document_dir.display(),
                e
            );
        } else {
            log::info!("Deleted document directory: {}", document_dir.display());
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_document_status(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DocumentStatus, ApiError> {
    let document = db::document::get_document(&state.db, &document_id).await?;

    Ok(DocumentStatus {
        status: document.status,
        error_details: document.error_details,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_document_pdf_path(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<String, ApiError> {
    let document = db::document::get_document(&state.db, &document_id).await?;

    let file_path = document
        .file_path
        .ok_or_else(|| ApiError::not_found("Document has no file path"))?;

    // Return raw file path - frontend will use convertFileSrc() to create proper asset URL
    Ok(file_path)
}

#[derive(serde::Deserialize, Type)]
pub struct ImportDocumentRequest {
    pub file_paths: Vec<String>,
    pub folder_id: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn import_documents(
    state: State<'_, AppState>,
    request: ImportDocumentRequest,
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, ApiError> {
    // Use provided folder_id or default to Drafts folder
    let folder_id = match request.folder_id {
        Some(id) => id,
        None => db::folder::get_default_folder_id(&state.db)
            .await
            .map_err(|e| {
                ApiError::internal_error(format!("Failed to get default folder: {}", e))
            })?,
    };

    let mut document_ids = Vec::new();

    for file_path in request.file_paths {
        // Validate and canonicalize the user-provided path
        let validated_path = validate_user_file_path(&file_path)?;

        // Verify it's a PDF file
        if validated_path.extension().and_then(|s| s.to_str()) != Some("pdf") {
            return Err(ApiError::invalid_input(format!(
                "File must be a PDF: {}",
                file_path
            )));
        }

        // Extract filename as initial title
        let title = validated_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();

        // Create document record
        let document_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Create document directory
        let document_dir = state.app_data_dir.join("documents").join(&document_id);
        std::fs::create_dir_all(&document_dir)?;

        // Copy PDF to document directory
        let dest_path = document_dir.join("original.pdf");
        std::fs::copy(&validated_path, &dest_path)?;

        let dest_path_str = dest_path
            .to_str()
            .ok_or_else(|| ApiError::file_error("Invalid path"))?
            .to_string();

        // Insert document into database
        sqlx::query(
            "INSERT INTO documents (id, folder_id, title, file_path, status, created_at, updated_at, accessed_at)
             VALUES (?, ?, ?, ?, 'pending_processing', ?, ?, ?)",
        )
        .bind(&document_id)
        .bind(&folder_id)
        .bind(&title)
        .bind(&dest_path_str)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await?;

        let _ = app_handle.emit(
            "document-status-changed",
            DocumentStatusChangedEvent {
                document_id: document_id.clone(),
                status: "pending_processing".to_string(),
                error_details: None,
                updated_at: now.clone(),
            },
        );

        document_ids.push(document_id.clone());

        // Spawn background processing task with concurrency limit
        let db = state.db.clone();
        let config_guard = state.config.read().await;
        let api_key = config_guard
            .get_api_key("gemini")
            .ok_or_else(|| ApiError::api_key_error("Gemini API key not configured"))?
            .clone();
        drop(config_guard); // Release lock before spawning task
        let app_handle_clone = app_handle.clone();
        let semaphore = state.processing_semaphore.clone();
        let app_data_dir_clone = state.app_data_dir.clone();

        tauri::async_runtime::spawn(async move {
            // Acquire permit to limit concurrent processing
            let _permit = semaphore.acquire().await.expect("Semaphore closed");
            log::info!(
                "Starting background processing for document {} (acquired processing permit)",
                document_id
            );

            match pipeline::process_document(
                &db,
                &document_id,
                &dest_path_str,
                &api_key,
                &app_data_dir_clone,
                app_handle_clone.clone(),
            )
            .await
            {
                Ok(_) => {
                    log::info!("Successfully processed document {}", document_id);
                }
                Err(e) => {
                    log::error!("Failed to process document {}: {:?}", document_id, e);
                    // Update document status to failed
                    let error_msg = format!("{:?}", e);
                    let error_details = serde_json::json!({"error": error_msg}).to_string();
                    let updated_at = chrono::Utc::now().to_rfc3339();
                    let _ = sqlx::query(
                        "UPDATE documents SET status = 'failed', error_details = ?, updated_at = ? WHERE id = ?",
                    )
                    .bind(error_details.clone())
                    .bind(updated_at.clone())
                    .bind(&document_id)
                    .execute(&db)
                    .await;

                    let _ = app_handle_clone.emit(
                        "document-status-changed",
                        DocumentStatusChangedEvent {
                            document_id: document_id.clone(),
                            status: "failed".to_string(),
                            error_details: Some(error_details),
                            updated_at,
                        },
                    );
                }
            }
            // Permit is automatically released when _permit is dropped
        });
    }

    Ok(document_ids)
}
