mod bindings;
mod commands;
mod config;
mod db;
mod error;
mod models;
mod pipeline;
mod rag;
mod services;
mod state;
mod validation;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Export bindings in debug mode before starting app
    #[cfg(debug_assertions)]
    bindings::export_bindings();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                let state = AppState::new(&app_handle)
                    .await
                    .expect("Failed to initialize app state");
                app_handle.manage(state);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // User commands
            commands::user::get_folders_with_documents,
            commands::user::get_recent_documents,
            commands::user::store_api_key,
            commands::user::delete_api_key,
            commands::user::list_models,
            commands::user::update_model_preference,
            commands::user::list_custom_providers,
            commands::user::store_custom_provider,
            commands::user::delete_custom_provider,
            // Folder commands
            commands::folder::create_folder,
            commands::folder::get_folder,
            commands::folder::update_folder,
            commands::folder::delete_folder,
            // Document commands
            commands::document::get_documents,
            commands::document::get_document,
            commands::document::update_document,
            commands::document::delete_document,
            commands::document::get_document_status,
            commands::document::get_document_pdf_path,
            commands::document::import_documents,
            // Chat commands
            commands::chat::get_chats,
            commands::chat::get_chat,
            commands::chat::create_chat,
            commands::chat::update_chat,
            commands::chat::delete_chat,
            commands::chat::list_messages,
            commands::chat::stream_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
