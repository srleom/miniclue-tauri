use futures::StreamExt;
use serde::Serialize;
use specta::Type;
use tauri::ipc::Channel;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::error::ApiError;
use crate::models::chat::{Chat, ChatCreate, ChatUpdate, MessageResponse};
use crate::rag;
use crate::services::llm;
use crate::state::AppState;
use crate::validation;

#[tauri::command]
#[specta::specta]
pub async fn get_chats(
    state: State<'_, AppState>,
    document_id: String,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Vec<Chat>, ApiError> {
    let limit = limit.unwrap_or(100) as i64;
    let offset = offset.unwrap_or(0) as i64;

    db::chat::get_chats(&state.db, &document_id, limit, offset)
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
#[specta::specta]
pub async fn get_chat(
    state: State<'_, AppState>,
    document_id: String,
    chat_id: String,
) -> Result<Chat, ApiError> {
    db::chat::get_chat(&state.db, &document_id, &chat_id)
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
#[specta::specta]
pub async fn create_chat(
    state: State<'_, AppState>,
    document_id: String,
    data: ChatCreate,
) -> Result<Chat, ApiError> {
    let id = Uuid::new_v4().to_string();
    let title = data.title.unwrap_or_else(|| "New Chat".to_string());

    // Validate chat title
    validation::validate_chat_name(&title)?;

    db::chat::create_chat(&state.db, &id, &document_id, &title)
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
#[specta::specta]
pub async fn update_chat(
    state: State<'_, AppState>,
    document_id: String,
    chat_id: String,
    data: ChatUpdate,
) -> Result<Chat, ApiError> {
    // Validate title if provided
    if let Some(ref title) = data.title {
        validation::validate_chat_name(title)?;
    }

    db::chat::update_chat(&state.db, &chat_id, &document_id, data.title.as_deref())
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_chat(
    state: State<'_, AppState>,
    document_id: String,
    chat_id: String,
) -> Result<(), ApiError> {
    db::chat::delete_chat(&state.db, &chat_id, &document_id)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_messages(
    state: State<'_, AppState>,
    document_id: String,
    chat_id: String,
    limit: Option<i32>,
) -> Result<Vec<MessageResponse>, ApiError> {
    let limit = limit.unwrap_or(100) as i64;

    // Verify chat belongs to document
    db::chat::get_chat(&state.db, &document_id, &chat_id).await?;

    let messages = db::chat::list_messages(&state.db, &chat_id, limit).await?;

    Ok(messages.into_iter().map(|m| m.into()).collect())
}

#[derive(Serialize, Clone, Debug, Type)]
#[serde(tag = "event")]
pub enum ChatStreamEvent {
    UserMessageSaved { message_id: String },
    Chunk { content: String },
    Done { message_id: String },
    Error { message: String },
}

#[derive(serde::Deserialize, Type)]
pub struct StreamChatRequest {
    pub document_id: String,
    pub chat_id: String,
    pub message: String, // User's message text
    pub model: String,   // Selected model
}

#[tauri::command]
#[specta::specta]
pub async fn stream_chat(
    state: State<'_, AppState>,
    request: StreamChatRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), ApiError> {
    // Validate message
    validation::validate_message(&request.message)?;

    let db = state.db.clone();
    let document_id = request.document_id.clone();
    let chat_id = request.chat_id.clone();
    let user_message = request.message.clone();
    let model = request.model.clone();

    // Get API key and base URL
    let config_guard = state.config.read().await;
    let api_key = config_guard
        .get_api_key("gemini") // TODO: Determine provider from model
        .ok_or_else(|| ApiError::api_key_error("API key not configured"))?
        .clone();
    drop(config_guard);

    // 1. Save user message
    let user_message_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Create message parts as JSON
    let parts = serde_json::json!([{"type": "text", "text": user_message}]).to_string();

    sqlx::query(
        "INSERT INTO messages (id, chat_id, role, parts, metadata, created_at)
         VALUES (?, ?, 'user', ?, '{}', ?)",
    )
    .bind(&user_message_id)
    .bind(&chat_id)
    .bind(&parts)
    .bind(&now)
    .execute(&db)
    .await?;

    on_event
        .send(ChatStreamEvent::UserMessageSaved {
            message_id: user_message_id.clone(),
        })
        .map_err(|e| ApiError::internal_error(e.to_string()))?;

    // 2. Get conversation history (last 10 messages for context)
    let messages = db::chat::list_messages(&db, &chat_id, 10).await?;

    let history: Vec<rag::query_rewriter::Message> = messages
        .iter()
        .map(|m| {
            // Extract text from parts JSON
            let parts_value: serde_json::Value =
                serde_json::from_str(&m.parts).unwrap_or(serde_json::Value::Array(vec![]));
            let text = parts_value
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(|part| part.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();

            rag::query_rewriter::Message {
                role: m.role.clone(),
                content: text,
            }
        })
        .collect();

    // 3. Rewrite query with history context (optional - use original if rewriting fails)
    let rewritten_query = rag::rewrite_query(
        &user_message,
        &history,
        &api_key,
        "gemini-2.0-flash-lite",
        llm::get_provider_base_url("gemini-2.0-flash-lite"),
    )
    .await
    .unwrap_or_else(|e| {
        log::warn!("Query rewriting failed: {}, using original query", e);
        user_message.clone()
    });

    // 4. Retrieve relevant chunks via RAG
    let chunks = rag::retrieve_chunks(&rewritten_query, &document_id, &db, &api_key, 5)
        .await
        .map_err(|e| ApiError::internal_error(format!("Failed to retrieve chunks: {}", e)))?;

    // 5. Build RAG context
    let rag_messages = rag::build_rag_context(&chunks, &history, &user_message, 5);

    // 6. Stream from LLM
    let mut stream = llm::stream_chat(rag_messages, model.clone(), api_key.clone())
        .await
        .map_err(|e| ApiError::internal_error(format!("Failed to start streaming: {}", e)))?;

    let mut full_response = String::new();

    while let Some(result) = stream.next().await {
        match result {
            Ok(content) => {
                full_response.push_str(&content);
                on_event
                    .send(ChatStreamEvent::Chunk {
                        content: content.clone(),
                    })
                    .map_err(|e| ApiError::internal_error(e.to_string()))?;
            }
            Err(e) => {
                on_event
                    .send(ChatStreamEvent::Error {
                        message: e.to_string(),
                    })
                    .ok();
                return Err(ApiError::internal_error(e.to_string()));
            }
        }
    }

    // 7. Save assistant message
    let assistant_message_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let assistant_parts = serde_json::json!([{"type": "text", "text": full_response}]).to_string();

    sqlx::query(
        "INSERT INTO messages (id, chat_id, role, parts, metadata, created_at)
         VALUES (?, ?, 'assistant', ?, '{}', ?)",
    )
    .bind(&assistant_message_id)
    .bind(&chat_id)
    .bind(&assistant_parts)
    .bind(&now)
    .execute(&db)
    .await?;

    on_event
        .send(ChatStreamEvent::Done {
            message_id: assistant_message_id,
        })
        .map_err(|e| ApiError::internal_error(e.to_string()))?;

    // 8. Trigger title generation if this is the first exchange (background task)
    let message_count = db::chat::count_messages(&db, &chat_id).await.unwrap_or(0);

    if message_count == 2 {
        // First exchange
        let db_clone = db.clone();
        let chat_id_clone = chat_id.clone();
        let model_clone = model.clone();

        tauri::async_runtime::spawn(async move {
            if let Err(e) =
                generate_chat_title(&db_clone, &chat_id_clone, &api_key, &model_clone).await
            {
                log::error!("Failed to generate chat title: {}", e);
            }
        });
    }

    Ok(())
}

async fn generate_chat_title(
    db: &sqlx::SqlitePool,
    chat_id: &str,
    api_key: &str,
    model: &str,
) -> Result<(), ApiError> {
    // Get first 2 messages
    let messages = db::chat::list_messages(db, chat_id, 2).await?;

    if messages.len() != 2 {
        return Ok(()); // Not ready yet
    }

    // Build messages for title generation
    let mut title_messages = vec![];

    for msg in &messages {
        let parts_value: serde_json::Value =
            serde_json::from_str(&msg.parts).unwrap_or(serde_json::Value::Array(vec![]));
        let text = parts_value
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|part| part.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        title_messages.push(rag::query_rewriter::Message {
            role: msg.role.clone(),
            content: text,
        });
    }

    // Add system message for title generation
    let system_message = rag::query_rewriter::Message {
        role: "system".to_string(),
        content: "Generate a concise title (max 80 chars) for this conversation. Return only the title, no quotes or explanations.".to_string(),
    };

    title_messages.insert(0, system_message);

    // Generate title
    let title = llm::generate_title(title_messages, api_key.to_string(), model.to_string())
        .await
        .map_err(|e| ApiError::internal_error(e.to_string()))?;

    // Update chat title
    let truncated_title = if title.len() > 80 {
        &title[..80]
    } else {
        &title
    };

    sqlx::query("UPDATE chats SET title = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(truncated_title)
        .bind(chat_id)
        .execute(db)
        .await?;

    Ok(())
}
