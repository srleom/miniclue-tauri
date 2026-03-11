use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Semaphore;

use crate::config::AppConfig;
use crate::db;
use crate::services::llama_server::LlamaServerManager;
use crate::services::model_manager::ModelManager;

const MAX_CONCURRENT_PROCESSING: usize = 3;

pub struct AppState {
    pub db: SqlitePool,
    pub app_data_dir: PathBuf,
    pub config: tokio::sync::RwLock<AppConfig>,
    /// Limits concurrent PDF processing tasks to prevent resource exhaustion
    pub processing_semaphore: Arc<Semaphore>,
    /// Manages llama-server sidecar instances (embed + chat)
    pub llama_server: Arc<LlamaServerManager>,
    /// Manages model catalog and downloads
    pub model_manager: Arc<ModelManager>,
}

/// Delete Gemini embeddings and reset affected documents to `pending_processing`
/// so they are re-indexed with the local 768-dim nomic-embed model.
async fn requeue_gemini_embedded_documents(
    db: &SqlitePool,
) -> Result<(), Box<dyn std::error::Error>> {
    // Find all documents with Gemini embeddings
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM documents WHERE embedding_model = 'gemini-embedding-001'")
            .fetch_all(db)
            .await?;

    if rows.is_empty() {
        return Ok(());
    }

    log::info!(
        "Re-queuing {} document(s) with Gemini embeddings for local re-indexing",
        rows.len()
    );

    for (doc_id,) in &rows {
        // Delete old Gemini embeddings (chunks are kept)
        sqlx::query("DELETE FROM embeddings WHERE document_id = ? AND embedding_model = 'gemini-embedding-001'")
            .bind(doc_id)
            .execute(db)
            .await?;

        // Reset document status so the processing pipeline picks it up again
        sqlx::query(
            "UPDATE documents SET status = 'pending_processing', embeddings_complete = 0, embedding_model = NULL, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(doc_id)
        .execute(db)
        .await?;
    }

    log::info!("Re-queue complete — documents will be re-indexed on next import or app restart");
    Ok(())
}

impl AppState {
    pub async fn new(app_handle: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("Failed to get app data directory");

        // Ensure directories exist
        std::fs::create_dir_all(&app_data_dir)?;
        std::fs::create_dir_all(app_data_dir.join("documents"))?;

        // Initialize SQLite database
        let db_path = app_data_dir.join("miniclue.db");
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
        let db = SqlitePool::connect(&db_url).await?;

        // Run migrations
        db::migrations::run(&db).await?;

        // Re-queue documents that have Gemini embeddings (incompatible with local 768-dim model)
        requeue_gemini_embedded_documents(&db).await?;

        // Ensure default folder exists
        db::folder::ensure_default_folder(&db)
            .await
            .expect("Failed to ensure default folder exists");

        // Load config
        let config = AppConfig::load(&app_data_dir)?;

        Ok(Self {
            db,
            app_data_dir,
            config: tokio::sync::RwLock::new(config),
            processing_semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_PROCESSING)),
            llama_server: Arc::new(LlamaServerManager::new()),
            model_manager: Arc::new(ModelManager::new()),
        })
    }
}
