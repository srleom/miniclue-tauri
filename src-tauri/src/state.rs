use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Semaphore;

use crate::config::AppConfig;
use crate::db;

const MAX_CONCURRENT_PROCESSING: usize = 3;

pub struct AppState {
    pub db: SqlitePool,
    pub app_data_dir: PathBuf,
    pub config: tokio::sync::RwLock<AppConfig>,
    /// Limits concurrent PDF processing tasks to prevent resource exhaustion
    pub processing_semaphore: Arc<Semaphore>,
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
        })
    }
}
