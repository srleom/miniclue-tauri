use tauri::State;

use crate::hardware::{detect_hardware, HardwareProfile};
use crate::state::AppState;

/// Detect and return the hardware profile of the current machine.
#[tauri::command]
#[specta::specta]
pub async fn get_hardware_profile(state: State<'_, AppState>) -> Result<HardwareProfile, String> {
    let app_data_path = state.app_data_dir.clone();
    let profile = detect_hardware(&app_data_path).await;
    Ok(profile)
}
