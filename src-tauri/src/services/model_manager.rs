//! Model manager: catalog fetching, local model download with progress, storage management.
//!
//! The catalog is loaded from:
//!  1. A cached copy at `{app_data}/model_catalog.json` (refreshed from GitHub).
//!  2. The bundled fallback at `resources/catalog.json` (always works offline).
//!
//! Models are downloaded from Hugging Face and stored at:
//!   `{app_data}/models/{model_id}/{filename}`

use reqwest::Client;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Catalog types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    /// File size in bytes (as f64 for TypeScript compatibility)
    #[specta(type = f64)]
    #[serde(alias = "size_bytes")]
    pub size_bytes: u64,
    pub sha256: Option<String>,
    #[serde(alias = "hf_repo")]
    pub hf_repo: String,
    #[serde(alias = "hf_filename")]
    pub hf_filename: String,
    #[serde(alias = "min_ram_gb")]
    pub min_ram_gb: u32,
    #[serde(alias = "is_default")]
    pub is_default: bool,
    #[serde(alias = "superseded_by")]
    pub superseded_by: Option<String>,
    pub tags: Vec<String>,
    /// Whether this model supports vision (image inputs)
    #[serde(default)]
    pub vision: bool,
    /// Vision projection model filename (e.g., "mmproj-F16.gguf") - required if vision=true
    #[serde(alias = "mmproj_filename")]
    pub mmproj_filename: Option<String>,
    /// Vision projection model file size in bytes
    #[specta(type = Option<f64>)]
    #[serde(alias = "mmproj_size_bytes")]
    pub mmproj_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    #[serde(alias = "schema_version")]
    pub schema_version: u32,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
    pub models: Vec<ModelEntry>,
}

// ---------------------------------------------------------------------------
// Local model status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    /// Model ID from catalog
    pub model_id: String,
    /// Whether the model file is present on disk
    pub is_downloaded: bool,
    /// Absolute path to the model file (if downloaded)
    pub path: Option<String>,
    /// File size on disk (0 if not downloaded)
    #[specta(type = f64)]
    pub size_on_disk: u64,
    /// Whether mmproj file is present (for vision models)
    pub mmproj_downloaded: bool,
    /// Absolute path to mmproj file (if downloaded)
    pub mmproj_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Download progress event (sent via Tauri event emitter)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub model_id: String,
    /// Bytes downloaded so far
    #[specta(type = f64)]
    pub downloaded_bytes: u64,
    /// Total file size (0 if unknown)
    #[specta(type = f64)]
    pub total_bytes: u64,
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

/// Tracks which model IDs are currently downloading to prevent double-starts.
pub struct ModelManager {
    downloading: Mutex<std::collections::HashSet<String>>,
}

impl ModelManager {
    pub fn new() -> Self {
        Self {
            downloading: Mutex::new(std::collections::HashSet::new()),
        }
    }

    /// Load the model catalog (cached → bundled fallback).
    pub async fn get_catalog(&self, app_handle: &AppHandle) -> Result<ModelCatalog, String> {
        let cache_path = catalog_cache_path(app_handle)?;

        // Try cached version first
        if cache_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&cache_path) {
                if let Ok(catalog) = serde_json::from_str::<ModelCatalog>(&content) {
                    return Ok(catalog);
                }
            }
        }

        // Fall back to bundled catalog
        load_bundled_catalog()
    }

    /// Refresh the catalog from GitHub (fire-and-forget, falls back silently).
    pub fn refresh_catalog_background(&self, app_handle: AppHandle) {
        tauri::async_runtime::spawn(async move {
            if let Ok(catalog) = fetch_remote_catalog().await {
                if let Ok(cache_path) = catalog_cache_path(&app_handle) {
                    if let Ok(json) = serde_json::to_string_pretty(&catalog) {
                        let _ = std::fs::write(cache_path, json);
                        log::info!("Model catalog refreshed from remote");
                    }
                }
            }
        });
    }

    /// Get local status for a specific model.
    pub fn get_model_status(
        &self,
        model_id: &str,
        app_handle: &AppHandle,
    ) -> Result<LocalModelStatus, String> {
        // We need to find the filename for this model from the catalog to check existence
        // For now, check if any .gguf file exists in the model directory
        let model_dir = model_dir(app_handle, model_id)?;
        let (is_downloaded, actual_path, size) = if model_dir.exists() {
            let gguf = find_gguf_in_dir(&model_dir);
            match gguf {
                Some(p) => {
                    let size = p.metadata().map(|m| m.len()).unwrap_or(0);
                    (true, Some(p.to_string_lossy().into_owned()), size)
                }
                None => (false, None, 0),
            }
        } else {
            (false, None, 0)
        };

        // Check for mmproj file (vision models only)
        let (mmproj_downloaded, mmproj_path) = if model_dir.exists() {
            let mmproj = find_mmproj_in_dir(&model_dir);
            match mmproj {
                Some(p) => (true, Some(p.to_string_lossy().into_owned())),
                None => (false, None),
            }
        } else {
            (false, None)
        };

        Ok(LocalModelStatus {
            model_id: model_id.to_string(),
            is_downloaded,
            path: actual_path,
            size_on_disk: size,
            mmproj_downloaded,
            mmproj_path,
        })
    }

    /// Download a model with progress events emitted to the frontend.
    ///
    /// Emits `"model-download-progress"` events with `DownloadProgress` payload.
    /// If mmproj_filename is provided, downloads both the model and mmproj files.
    pub async fn download_model(
        &self,
        model_id: &str,
        hf_repo: &str,
        hf_filename: &str,
        mmproj_filename: Option<&str>,
        app_handle: &AppHandle,
    ) -> Result<String, String> {
        // Prevent concurrent downloads of the same model
        {
            let mut set = self.downloading.lock().await;
            if set.contains(model_id) {
                return Err(format!("Model '{}' is already downloading", model_id));
            }
            set.insert(model_id.to_string());
        }

        let result = self
            .do_download_with_mmproj(model_id, hf_repo, hf_filename, mmproj_filename, app_handle)
            .await;

        self.downloading.lock().await.remove(model_id);
        result
    }

    async fn do_download_with_mmproj(
        &self,
        model_id: &str,
        hf_repo: &str,
        hf_filename: &str,
        mmproj_filename: Option<&str>,
        app_handle: &AppHandle,
    ) -> Result<String, String> {
        // Download main model file
        let model_path = self
            .do_download(model_id, hf_repo, hf_filename, app_handle)
            .await?;

        // Download mmproj file if specified
        if let Some(mmproj_file) = mmproj_filename {
            log::info!("Downloading mmproj file for {model_id}: {mmproj_file}");
            self.do_download(model_id, hf_repo, mmproj_file, app_handle)
                .await?;
        }

        Ok(model_path)
    }

    async fn do_download(
        &self,
        model_id: &str,
        hf_repo: &str,
        hf_filename: &str,
        app_handle: &AppHandle,
    ) -> Result<String, String> {
        let dest_dir = model_dir(app_handle, model_id)?;
        std::fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create model dir: {e}"))?;

        let dest_path = dest_dir.join(hf_filename);

        // Skip if already complete
        if dest_path.exists() {
            return Ok(dest_path.to_string_lossy().into_owned());
        }

        let url = format!("https://huggingface.co/{hf_repo}/resolve/main/{hf_filename}");

        log::info!("Downloading model {model_id} from {url}");

        let client = Client::builder()
            .timeout(Duration::from_secs(3600))
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Download request failed: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("Download failed: HTTP {}", response.status()));
        }

        let total_bytes = response.content_length().unwrap_or(0);

        // Download to a temp file first, then rename
        let tmp_path = dest_dir.join(format!("{hf_filename}.tmp"));
        let mut file = std::fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {e}"))?;

        let mut downloaded: u64 = 0;
        let mut last_emit_bytes: u64 = 0;
        let emit_interval: u64 = 1024 * 1024 * 5; // emit every 5 MB

        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
            file.write_all(&chunk)
                .map_err(|e| format!("Write error: {e}"))?;
            downloaded += chunk.len() as u64;

            if downloaded - last_emit_bytes >= emit_interval || downloaded == total_bytes {
                last_emit_bytes = downloaded;
                let _ = app_handle.emit(
                    "model-download-progress",
                    DownloadProgress {
                        model_id: model_id.to_string(),
                        downloaded_bytes: downloaded,
                        total_bytes,
                    },
                );
            }
        }

        drop(file);

        // Rename tmp → final
        std::fs::rename(&tmp_path, &dest_path)
            .map_err(|e| format!("Failed to rename temp file: {e}"))?;

        log::info!("Model {model_id} downloaded to {}", dest_path.display());
        Ok(dest_path.to_string_lossy().into_owned())
    }

    /// Delete a downloaded model from disk.
    pub fn delete_model(&self, model_id: &str, app_handle: &AppHandle) -> Result<(), String> {
        let dir = model_dir(app_handle, model_id)?;
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("Failed to delete model dir: {e}"))?;
            log::info!("Deleted model {model_id}");
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

const REMOTE_CATALOG_URL: &str =
    "https://raw.githubusercontent.com/miniclue-app/miniclue-catalog/main/catalog.json";

const BUNDLED_CATALOG: &str = include_str!("../../resources/catalog.json");

fn load_bundled_catalog() -> Result<ModelCatalog, String> {
    serde_json::from_str(BUNDLED_CATALOG)
        .map_err(|e| format!("Failed to parse bundled catalog: {e}"))
}

/// Return the friendly display name for a local model ID using the bundled catalog.
/// Falls back to `None` when the ID is not found.
pub fn get_bundled_model_name(model_id: &str) -> Option<String> {
    load_bundled_catalog()
        .ok()?
        .models
        .into_iter()
        .find(|m| m.id == model_id)
        .map(|m| m.name)
}

async fn fetch_remote_catalog() -> Result<ModelCatalog, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(REMOTE_CATALOG_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Remote catalog returned HTTP {}",
            response.status()
        ));
    }

    response
        .json::<ModelCatalog>()
        .await
        .map_err(|e| format!("Failed to parse remote catalog: {e}"))
}

fn catalog_cache_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(app_data.join("model_catalog.json"))
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn model_dir(app_handle: &AppHandle, model_id: &str) -> Result<PathBuf, String> {
    let app_cache = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get app cache dir: {e}"))?;
    Ok(app_cache.join("models").join(model_id))
}

fn find_gguf_in_dir(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .find_map(|e| {
            let path = e.path();
            if path.extension().and_then(|s| s.to_str()) == Some("gguf") {
                Some(path)
            } else {
                None
            }
        })
}

fn find_mmproj_in_dir(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .find_map(|e| {
            let path = e.path();
            let filename = path.file_name()?.to_str()?;
            if filename.starts_with("mmproj-")
                && path.extension().and_then(|s| s.to_str()) == Some("gguf")
            {
                Some(path)
            } else {
                None
            }
        })
}

/// Recommend a model ID based on available RAM and GPU presence.
///
/// Priority is *response speed* first, quality second. The 0.6B model runs
/// at ~40 tok/s on a modern CPU; the 1.7B at ~20 tok/s; the 4B at ~8 tok/s.
/// Only push to a larger model when the machine can sustain a usable speed.
///
/// | RAM       | CPU-only        | GPU present     |
/// |-----------|-----------------|-----------------|
/// | < 4 GB    | qwen3-0b6-q8    | qwen3-0b6-q8    |
/// | 4–7 GB    | qwen3-0b6-q8    | qwen3-1b7-q8    |
/// | 8–15 GB   | qwen3-1b7-q8    | qwen3-4b-q4     |
/// | ≥ 16 GB   | qwen3-1b7-q8    | qwen3-4b-q4     |
pub fn recommend_model_id(total_ram_bytes: u64, has_gpu: bool) -> &'static str {
    let ram_gb = total_ram_bytes / (1024 * 1024 * 1024);
    match (ram_gb, has_gpu) {
        (0..=3, _) => "qwen3-0b6-q8",
        (4..=7, false) => "qwen3-0b6-q8",
        (4..=7, true) => "qwen3-1b7-q8",
        (8..=15, false) => "qwen3-1b7-q8",
        (8..=15, true) => "qwen3-4b-q4",
        (_, false) => "qwen3-1b7-q8",
        (_, true) => "qwen3-4b-q4",
    }
}
