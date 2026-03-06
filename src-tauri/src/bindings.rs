//! TypeScript bindings generator for Tauri commands
//!
//! This module exports all Tauri commands and types to TypeScript.
//! The generated file is written to `../src/lib/bindings.ts`.
//!
//! To regenerate bindings: `bun run gen:bindings`

use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

use crate::commands;

/// Export TypeScript bindings for all Tauri commands and types
pub fn export_bindings() {
    let builder = Builder::<tauri::Wry>::new()
        // Collect all commands
        .commands(collect_commands![
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
        ]);

    // Only export in debug builds (during development)
    #[cfg(debug_assertions)]
    {
        builder
            .export(
                Typescript::default().header("// @ts-nocheck"),
                "../src/lib/bindings.ts",
            )
            .expect("Failed to export TypeScript bindings");

        println!("✅ TypeScript bindings exported to src/lib/bindings.ts");
    }
}
