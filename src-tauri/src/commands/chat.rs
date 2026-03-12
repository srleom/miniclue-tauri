use futures::StreamExt;
use serde::Serialize;
use specta::Type;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri::State;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::db;
use crate::error::ApiError;
use crate::models::chat::{Chat, ChatCreate, ChatUpdate, MessageResponse};
use crate::rag;
use crate::services::llama_server::ServerStatus;
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
    UserMessageSaved {
        message_id: String,
    },
    Chunk {
        content: String,
    },
    Done {
        message_id: String,
    },
    TitleUpdated {
        chat_id: String,
        title: String,
        updated_at: String,
    },
    Error {
        message: String,
    },
}

#[derive(serde::Deserialize, Type)]
pub struct StreamChatRequest {
    pub document_id: String,
    pub chat_id: String,
    pub message: String, // User's message text
    pub model: String,   // Selected model
    /// Pages explicitly cited by the user (e.g. via @5 or @currentSlide).
    /// These pages are force-included in the RAG context regardless of semantic similarity.
    pub cited_pages: Option<Vec<i32>>,
}

/// Resolved credentials for a given model string.
struct ModelCredentials {
    /// The actual model identifier to send to the LLM API
    model: String,
    /// The API key to use
    api_key: String,
    /// Override base URL (for custom providers)
    base_url_override: Option<String>,
}

/// Resolve the API key, actual model, and optional base URL override from the model string.
///
/// For standard providers the model string is the model id itself; the provider is derived
/// from the model prefix (same logic as `get_provider_base_url`).
///
/// For custom providers the model string is `"custom:{id}"` and we look up the stored
/// CustomProvider to retrieve its api_key, model_id, and base_url.
fn resolve_model_credentials(
    model: &str,
    config: &AppConfig,
) -> Result<ModelCredentials, ApiError> {
    // Local chat server — no API key required
    if model == "local" || model.starts_with("local:") {
        let model_id = model
            .strip_prefix("local:")
            .unwrap_or("local-model")
            .to_string();
        return Ok(ModelCredentials {
            model: model_id,
            api_key: String::new(),
            base_url_override: Some(format!(
                "http://127.0.0.1:{}/v1",
                crate::services::llama_server::CHAT_PORT
            )),
        });
    }

    if let Some(id) = model.strip_prefix("custom:") {
        let cp = config.get_custom_provider(id).ok_or_else(|| {
            ApiError::invalid_input(format!("Custom provider '{}' not found", id))
        })?;
        return Ok(ModelCredentials {
            model: cp.model_id.clone(),
            api_key: cp.api_key.clone(),
            base_url_override: Some(cp.base_url.clone()),
        });
    }

    // Standard provider — derive from model prefix
    let provider = if model.starts_with("gemini") || model.starts_with("models/gemini") {
        "gemini"
    } else if model.starts_with("gpt") || model.starts_with("o1") {
        "openai"
    } else if model.starts_with("claude") {
        "anthropic"
    } else if model.starts_with("grok") {
        "xai"
    } else if model.starts_with("deepseek") {
        "deepseek"
    } else {
        return Err(ApiError::invalid_input(format!(
            "Cannot determine provider for model '{}'",
            model
        )));
    };

    let api_key = config
        .get_api_key(provider)
        .ok_or_else(|| ApiError::api_key_error(format!("API key not configured for {}", provider)))?
        .clone();

    Ok(ModelCredentials {
        model: model.to_string(),
        api_key,
        base_url_override: None,
    })
}

fn extract_first_text_from_parts(parts_json: &str) -> String {
    let parts_value: serde_json::Value =
        serde_json::from_str(parts_json).unwrap_or(serde_json::Value::Array(vec![]));
    parts_value
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|part| part.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string()
}

fn truncate_generated_title(raw_title: &str) -> String {
    let trimmed = raw_title.trim();
    if trimmed.is_empty() {
        return "New Chat".to_string();
    }

    if trimmed.chars().count() > rag::prompts::TITLE_MAX_LENGTH {
        let shortened: String = trimmed
            .chars()
            .take(rag::prompts::TITLE_MAX_LENGTH - 3)
            .collect();
        format!("{}...", shortened)
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
#[specta::specta]
pub async fn stream_chat(
    state: State<'_, AppState>,
    app_handle: AppHandle,
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

    // Resolve credentials for the selected model
    let config_guard = state.config.read().await;
    let credentials = resolve_model_credentials(&model, &config_guard)?;

    // Gemini key is optional — only needed for query rewriting, RAG, and title generation
    let gemini_key: Option<String> = config_guard.get_api_key("gemini").cloned();
    drop(config_guard);

    // If using local chat, ensure the server is running — restart it if it terminated.
    if model == "local" || model.starts_with("local:") {
        let chat_status = state.llama_server.chat_status().await;
        if !matches!(chat_status, ServerStatus::Running | ServerStatus::Starting) {
            log::info!(
                "[stream_chat] local chat server is {:?} — attempting restart",
                chat_status
            );
            let model_path = state
                .config
                .read()
                .await
                .settings
                .local_chat_model_path
                .clone()
                .ok_or_else(|| {
                    ApiError::invalid_input("Local chat model path not configured".to_string())
                })?;
            state
                .llama_server
                .start_chat_server(&app_handle, &model_path)
                .await
                .map_err(|e| {
                    ApiError::internal_error(format!("Failed to restart local chat server: {e}"))
                })?;
        }
    }

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
        .map(|m| rag::query_rewriter::Message {
            role: m.role.clone(),
            content: extract_first_text_from_parts(&m.parts),
        })
        .collect();

    // 3 & 4. Run query rewriting and RAG retrieval in parallel to minimise latency.
    //
    // Query rewriting is skipped when:
    //   - no Gemini key is available, OR
    //   - the user is on a local model (avoid cloud round-trips for local-only users), OR
    //   - there is no conversation history (rewriting gives zero benefit on the first message).
    //
    // RAG retrieval always uses the *original* query so it can start immediately, in parallel
    // with rewriting.  The rewritten query (when available) is used as the final user message
    // sent to the LLM; chunks are retrieved from the original query with negligible quality
    // difference because rewrites are minor rephrasing.
    let is_local_model = model == "local" || model.starts_with("local:");
    let has_history = !history.is_empty();
    let should_rewrite = gemini_key.is_some() && !is_local_model && has_history;

    let rewrite_fut = async {
        if should_rewrite {
            let gkey = gemini_key.as_deref().unwrap();
            rag::rewrite_query_streaming(&user_message, &history, gkey)
                .await
                .unwrap_or_else(|e| {
                    log::warn!("Query rewriting failed: {}, using original query", e);
                    user_message.clone()
                })
        } else {
            if is_local_model {
                log::info!("Local model — skipping query rewriting");
            } else if !has_history {
                log::info!("No prior history — skipping query rewriting on first message");
            } else {
                log::info!("No Gemini key — skipping query rewriting");
            }
            user_message.clone()
        }
    };

    let rag_fut = rag::retrieve_chunks(&user_message, &document_id, &db, 3);

    let (rewritten_query, chunks) = tokio::join!(rewrite_fut, rag_fut);
    let mut chunks = chunks.unwrap_or_else(|e| {
        log::warn!("RAG retrieval failed: {}, using empty chunks", e);
        vec![]
    });

    // Force-include chunks from explicitly cited pages (user's @slide references).
    // These are prepended so they appear first in the LLM context, then deduplicated
    // to avoid repeating the same chunk from semantic retrieval.
    if let Some(cited_pages) = &request.cited_pages {
        if !cited_pages.is_empty() {
            match db::embedding::get_chunks_for_pages(&db, &document_id, cited_pages).await {
                Ok(cited_rows) => {
                    let mut cited_chunks: Vec<rag::retriever::RetrievedChunk> = cited_rows
                        .into_iter()
                        .map(
                            |(chunk_id, text, page_number)| rag::retriever::RetrievedChunk {
                                chunk_id,
                                text,
                                page_number,
                                distance: 0.0, // Cited pages are treated as most relevant
                            },
                        )
                        .collect();

                    // Deduplicate: remove from semantic results any chunks already in cited_chunks
                    let cited_ids: std::collections::HashSet<&str> =
                        cited_chunks.iter().map(|c| c.chunk_id.as_str()).collect();
                    chunks.retain(|c| !cited_ids.contains(c.chunk_id.as_str()));

                    // Prepend cited chunks so the LLM sees them first
                    cited_chunks.extend(chunks);
                    chunks = cited_chunks;
                }
                Err(e) => {
                    log::warn!(
                        "Failed to fetch cited page chunks: {}, ignoring citation",
                        e
                    );
                }
            }
        }
    }

    // 5. Build RAG context (rewritten query used as the final user message for the LLM)
    let rag_messages = rag::build_rag_context(&chunks, &history, &rewritten_query, 3);

    // 6. Stream from LLM
    let mut stream = llm::stream_chat(
        rag_messages,
        credentials.model.clone(),
        credentials.api_key.clone(),
        credentials.base_url_override.clone(),
    )
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
    //    Only possible when a Gemini key is available (title generation uses Gemini).
    let message_count = db::chat::count_messages(&db, &chat_id).await.unwrap_or(0);

    if message_count == 2 {
        // First exchange
        if let Some(gkey) = gemini_key {
            let db_clone = db.clone();
            let chat_id_clone = chat_id.clone();
            let model_clone = credentials.model.clone();
            let on_event_clone = on_event.clone();

            tauri::async_runtime::spawn(async move {
                match generate_chat_title(&db_clone, &chat_id_clone, &gkey, &model_clone).await {
                    Ok(Some((title, updated_at))) => {
                        if let Err(e) = on_event_clone.send(ChatStreamEvent::TitleUpdated {
                            chat_id: chat_id_clone,
                            title,
                            updated_at,
                        }) {
                            log::warn!("Failed to send title update event: {}", e);
                        }
                    }
                    Ok(None) => {}
                    Err(e) => {
                        log::error!("Failed to generate chat title: {}", e);
                    }
                }
            });
        } else {
            log::info!("No Gemini key — skipping title generation");
        }
    }

    Ok(())
}

async fn generate_chat_title(
    db: &sqlx::SqlitePool,
    chat_id: &str,
    api_key: &str,
    model: &str,
) -> Result<Option<(String, String)>, ApiError> {
    // Get first 2 messages
    let messages = db::chat::list_messages(db, chat_id, 2).await?;

    if messages.len() != 2 {
        return Ok(None); // Not ready yet
    }

    let first_user = messages.iter().find(|m| m.role == "user");
    let first_assistant = messages.iter().find(|m| m.role == "assistant");
    let (Some(first_user), Some(first_assistant)) = (first_user, first_assistant) else {
        return Ok(None);
    };

    let title_context = rag::prompts::build_title_conversation_context(
        &extract_first_text_from_parts(&first_user.parts),
        &extract_first_text_from_parts(&first_assistant.parts),
    );

    // Build messages for title generation in legacy format: [system, user]
    let title_messages = vec![
        rag::query_rewriter::Message {
            role: "system".to_string(),
            content: rag::prompts::title_system_prompt(),
        },
        rag::query_rewriter::Message {
            role: "user".to_string(),
            content: title_context,
        },
    ];

    // Generate title
    log::info!(
        "[generate_chat_title] Calling llm::generate_title for chat_id={}",
        chat_id
    );

    let title = llm::generate_title(title_messages, api_key.to_string(), model.to_string())
        .await
        .map_err(|e| {
            log::error!("[generate_chat_title] Title generation failed: {}", e);
            ApiError::internal_error(e.to_string())
        })?;

    log::info!("[generate_chat_title] Generated title: \"{}\"", title);

    // Validate and truncate title to match legacy behavior.
    let truncated_title = truncate_generated_title(&title);

    let (saved_title, updated_at): (String, String) = sqlx::query_as(
        "UPDATE chats SET title = ?, updated_at = datetime('now') WHERE id = ? \
         RETURNING title, updated_at",
    )
    .bind(&truncated_title)
    .bind(chat_id)
    .fetch_one(db)
    .await?;

    log::info!(
        "[generate_chat_title] Successfully updated title in database for chat_id={}",
        chat_id
    );

    Ok(Some((saved_title, updated_at)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_first_text_from_parts() {
        let json = r#"[{"type":"text","text":"hello world"}]"#;
        assert_eq!(extract_first_text_from_parts(json), "hello world");
    }

    #[test]
    fn test_truncate_generated_title_uses_ellipsis_at_eighty_chars() {
        let long = "a".repeat(120);
        let title = truncate_generated_title(&long);
        assert_eq!(title.len(), rag::prompts::TITLE_MAX_LENGTH);
        assert!(title.ends_with("..."));
    }

    #[test]
    fn test_truncate_generated_title_empty_fallback() {
        assert_eq!(truncate_generated_title("   "), "New Chat");
    }
}
