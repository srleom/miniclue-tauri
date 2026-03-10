//! Commands for local AI model management.

use tauri::{AppHandle, State};

use crate::error::ApiError;
use crate::hardware::detect_hardware;
use crate::services::llama_server::LlamaStatus;
use crate::services::model_manager::{
    recommend_model_id, LocalModelStatus, ModelCatalog, ModelEntry,
};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/// Return the model catalog (cached remote → bundled fallback).
#[tauri::command]
#[specta::specta]
pub async fn get_model_catalog(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<ModelCatalog, ApiError> {
    state
        .model_manager
        .get_catalog(&app_handle)
        .await
        .map_err(ApiError::internal_error)
}

/// Return the recommended model ID for this machine based on hardware.
#[tauri::command]
#[specta::specta]
pub async fn get_recommended_model_id(state: State<'_, AppState>) -> Result<String, ApiError> {
    let profile = detect_hardware(&state.app_data_dir).await;
    let has_gpu = !matches!(
        profile.gpu_class,
        crate::hardware::GpuClass::CpuOnly | crate::hardware::GpuClass::Unknown
    );
    let id = recommend_model_id(profile.total_ram_bytes, has_gpu);
    Ok(id.to_string())
}

// ---------------------------------------------------------------------------
// Model status
// ---------------------------------------------------------------------------

/// Return download/presence status for a specific model ID.
#[tauri::command]
#[specta::specta]
pub async fn get_local_model_status(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    model_id: String,
) -> Result<LocalModelStatus, ApiError> {
    state
        .model_manager
        .get_model_status(&model_id, &app_handle)
        .map_err(ApiError::internal_error)
}

// ---------------------------------------------------------------------------
// Download / Delete
// ---------------------------------------------------------------------------

/// Start downloading a model in the background with progress events.
///
/// Emits `"model-download-progress"` events during download.
/// Returns the local file path when complete.
#[tauri::command]
#[specta::specta]
pub async fn download_local_model(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    model_id: String,
) -> Result<String, ApiError> {
    // Look up entry from catalog
    let catalog = state
        .model_manager
        .get_catalog(&app_handle)
        .await
        .map_err(ApiError::internal_error)?;

    let entry: &ModelEntry = catalog
        .models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| ApiError::not_found(format!("Model '{}' not in catalog", model_id)))?;

    let path = state
        .model_manager
        .download_model(&model_id, &entry.hf_repo, &entry.hf_filename, &app_handle)
        .await
        .map_err(ApiError::internal_error)?;

    Ok(path)
}

/// Delete a downloaded model from disk.
#[tauri::command]
#[specta::specta]
pub async fn delete_local_model(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    model_id: String,
) -> Result<(), ApiError> {
    state
        .model_manager
        .delete_model(&model_id, &app_handle)
        .map_err(ApiError::internal_error)?;

    // If this was the active model, clear the setting
    let mut config = state.config.write().await;
    if config.settings.local_chat_model_id.as_deref() == Some(&model_id) {
        config.settings.local_chat_model_id = None;
        config.settings.local_chat_model_path = None;
        config.settings.local_chat_enabled = false;
        config
            .save()
            .map_err(|e| ApiError::internal_error(e.to_string()))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Enable / Disable
// ---------------------------------------------------------------------------

/// Enable or disable local chat and set the active model.
#[tauri::command]
#[specta::specta]
pub async fn set_local_chat_enabled(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    enabled: bool,
    model_id: Option<String>,
) -> Result<(), ApiError> {
    let mut config = state.config.write().await;
    config.settings.local_chat_enabled = enabled;

    if let Some(ref mid) = model_id {
        // Find the model path
        let status = state
            .model_manager
            .get_model_status(mid, &app_handle)
            .map_err(ApiError::internal_error)?;

        if enabled && !status.is_downloaded {
            return Err(ApiError::invalid_input(format!(
                "Model '{}' is not downloaded",
                mid
            )));
        }

        config.settings.local_chat_model_id = Some(mid.clone());
        config.settings.local_chat_model_path = status.path;
    }

    config
        .save()
        .map_err(|e| ApiError::internal_error(e.to_string()))?;

    // If enabling, also start the chat server
    if enabled {
        if let Some(ref path) = config.settings.local_chat_model_path.clone() {
            let path_clone = path.clone();
            drop(config);
            state
                .llama_server
                .start_chat_server(&app_handle, &path_clone)
                .await
                .map_err(ApiError::internal_error)?;
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

/// Return the current status of both llama-server instances.
#[tauri::command]
#[specta::specta]
pub async fn get_llama_server_status(state: State<'_, AppState>) -> Result<LlamaStatus, ApiError> {
    Ok(state.llama_server.status_summary().await)
}
