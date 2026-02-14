use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::error::ApiError;
use crate::models::folder::{FolderCreate, FolderResponse, FolderUpdate};
use crate::state::AppState;
use crate::validation;

#[tauri::command]
#[specta::specta]
pub async fn create_folder(
    state: State<'_, AppState>,
    data: FolderCreate,
) -> Result<FolderResponse, ApiError> {
    // Validate input
    validation::validate_title(&data.title)?;

    let description = data.description.unwrap_or_default();
    if !description.is_empty() {
        validation::validate_description(&description)?;
    }

    let id = Uuid::new_v4().to_string();
    let is_default = data.is_default.unwrap_or(false);

    let folder =
        db::folder::create_folder(&state.db, &id, &data.title, &description, is_default).await?;

    Ok(folder.into())
}

#[tauri::command]
#[specta::specta]
pub async fn get_folder(
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<FolderResponse, ApiError> {
    let folder = db::folder::get_folder(&state.db, &folder_id).await?;

    Ok(folder.into())
}

#[tauri::command]
#[specta::specta]
pub async fn update_folder(
    state: State<'_, AppState>,
    folder_id: String,
    data: FolderUpdate,
) -> Result<FolderResponse, ApiError> {
    // Validate input if provided
    if let Some(ref title) = data.title {
        validation::validate_title(title)?;
    }
    if let Some(ref description) = data.description {
        if !description.is_empty() {
            validation::validate_description(description)?;
        }
    }

    let folder = db::folder::update_folder(
        &state.db,
        &folder_id,
        data.title.as_deref(),
        data.description.as_deref(),
    )
    .await?;

    Ok(folder.into())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_folder(state: State<'_, AppState>, folder_id: String) -> Result<(), ApiError> {
    db::folder::delete_folder(&state.db, &folder_id).await?;

    Ok(())
}
