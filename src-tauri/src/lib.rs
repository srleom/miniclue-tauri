mod bindings;
mod catalog;
mod commands;
mod config;
mod db;
mod error;
mod hardware;
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
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

            // Start the embed server in the background (non-blocking).
            // The app window opens immediately; the server warms up in ~1-2s.
            {
                let state = app.handle().state::<AppState>();

                state
                    .llama_server
                    .start_embed_server_background(app.handle().clone());

                // Start the chat server eagerly if a local model is already configured.
                // This runs in parallel with embed-server warmup so that by the time
                // the user opens a document and types their first message, the server
                // is already warm — zero cold-start on subsequent launches.
                let model_path = state
                    .config
                    .blocking_read()
                    .settings
                    .local_chat_model_path
                    .clone();
                let mmproj_path = state
                    .config
                    .blocking_read()
                    .settings
                    .local_chat_mmproj_path
                    .clone();
                if let Some(path) = model_path {
                    log::info!(
                        "[startup] local chat model configured — pre-warming chat server: {}",
                        path
                    );
                    state.llama_server.start_chat_server_background(
                        app.handle().clone(),
                        path,
                        mmproj_path,
                    );
                }

                // Refresh model catalog from remote in background
                state
                    .model_manager
                    .refresh_catalog_background(app.handle().clone());
            }

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
            // Hardware commands
            commands::hardware::get_hardware_profile,
            // Local model commands
            commands::local_model::get_model_catalog,
            commands::local_model::get_recommended_model_id,
            commands::local_model::get_local_model_status,
            commands::local_model::get_models_storage_path,
            commands::local_model::download_local_model,
            commands::local_model::delete_local_model,
            commands::local_model::set_local_chat_enabled,
            commands::local_model::get_llama_server_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
