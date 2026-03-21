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
    /// Pages explicitly cited by the user (e.g. via @5 or @currentPage).
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

/// Map a chat model to the corresponding small aux model for the same provider.
///
/// Returns `None` when the provider is unknown or no API key is configured.
fn get_aux_model_credentials(model: &str, config: &AppConfig) -> Option<ModelCredentials> {
    // Local: use same local model (no cloud round-trip)
    if model == "local" || model.starts_with("local:") {
        return Some(ModelCredentials {
            model: model
                .strip_prefix("local:")
                .unwrap_or("local-model")
                .to_string(),
            api_key: String::new(),
            base_url_override: Some(format!(
                "http://127.0.0.1:{}/v1",
                crate::services::llama_server::CHAT_PORT
            )),
        });
    }

    // Custom: use same custom provider model
    if let Some(id) = model.strip_prefix("custom:") {
        let cp = config.get_custom_provider(id)?;
        return Some(ModelCredentials {
            model: cp.model_id.clone(),
            api_key: cp.api_key.clone(),
            base_url_override: Some(cp.base_url.clone()),
        });
    }

    // Standard providers: map to small aux model
    let (aux_model, provider) = if model.starts_with("gpt") || model.starts_with("o1") {
        ("gpt-4.1-nano", "openai")
    } else if model.starts_with("claude") {
        ("claude-haiku-4-5", "anthropic")
    } else if model.starts_with("gemini") || model.starts_with("models/gemini") {
        ("gemini-3.1-flash-lite-preview", "gemini") // lightest Gemini model
    } else if model.starts_with("grok") {
        ("grok-4-1-fast-non-reasoning", "xai")
    } else if model.starts_with("deepseek") {
        ("deepseek-chat", "deepseek")
    } else {
        return None;
    };

    config.get_api_key(provider).map(|key| ModelCredentials {
        model: aux_model.to_string(),
        api_key: key.clone(),
        base_url_override: None,
    })
}

fn get_provider_name(model: &str) -> &'static str {
    if model == "local" || model.starts_with("local:") {
        "local"
    } else if model.starts_with("custom:") {
        "custom"
    } else if model.starts_with("gemini") || model.starts_with("models/gemini") {
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
        "unknown"
    }
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

fn annotate_query_with_cited_pages(query: &str, cited_pages: Option<&[i32]>) -> String {
    let Some(pages) = cited_pages else {
        return query.to_string();
    };
    if pages.is_empty() {
        return query.to_string();
    }

    let page_list = pages
        .iter()
        .map(std::string::ToString::to_string)
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "{}\n\nReferenced pages: {}. Tokens like @N refer to page N in this document.",
        query, page_list
    )
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

    // Ensure the chat belongs to the document before any history reads or inserts.
    db::chat::get_chat(&db, &document_id, &chat_id).await?;

    // Resolve credentials for the selected model
    let config_guard = state.config.read().await;
    let credentials = resolve_model_credentials(&model, &config_guard)?;

    // Aux credentials use a small model from the same provider for query rewriting and title generation.
    let aux_credentials = get_aux_model_credentials(&model, &config_guard);

    let local_model_id = if model == "local" {
        config_guard.settings.local_chat_model_id.clone()
    } else {
        model.strip_prefix("local:").map(str::to_string)
    };
    drop(config_guard);

    let local_model_supports_vision = if model == "local" || model.starts_with("local:") {
        match (
            &local_model_id,
            state.model_manager.get_catalog(&app_handle).await,
        ) {
            (Some(local_id), Ok(catalog)) => catalog
                .models
                .iter()
                .find(|m| m.id == *local_id)
                .map(|m| m.vision)
                .unwrap_or(false),
            _ => false,
        }
    } else {
        false
    };

    // If using local chat, ensure the server is running — restart it if it terminated.
    if model == "local" || model.starts_with("local:") {
        let chat_status = state.llama_server.chat_status().await;
        if !matches!(chat_status, ServerStatus::Running | ServerStatus::Starting) {
            log::info!(
                "[stream_chat] local chat server is {:?} — attempting restart",
                chat_status
            );
            let (model_path, mmproj_path) = {
                let cfg = state.config.read().await;
                let model_path = cfg.settings.local_chat_model_path.clone().ok_or_else(|| {
                    ApiError::invalid_input("Local chat model path not configured".to_string())
                })?;
                let mmproj_path = cfg.settings.local_chat_mmproj_path.clone();
                (model_path, mmproj_path)
            };
            state
                .llama_server
                .start_chat_server(&app_handle, &model_path, mmproj_path.as_deref())
                .await
                .map_err(|e| {
                    ApiError::internal_error(format!("Failed to restart local chat server: {e}"))
                })?;
        }
    }

    // 1. Get conversation history (last 10 messages for context) — fetch BEFORE saving the
    //    current user message so it only contains prior turns (avoids duplicate user message
    //    in the LLM payload).
    let messages = db::chat::list_recent_messages(&db, &chat_id, 10).await?;

    let history: Vec<rag::query_rewriter::Message> = messages
        .iter()
        .map(|m| {
            rag::query_rewriter::Message::text(&m.role, &extract_first_text_from_parts(&m.parts))
        })
        .collect();

    // 2. Save user message
    let user_message_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Create message parts as JSON
    let parts = serde_json::json!([{"type": "text", "text": user_message}]).to_string();

    // Include cited_pages in initial metadata; rewritten_query and rag_chunk_ids
    // will be added via UPDATE after RAG retrieval completes.
    let user_metadata_initial = serde_json::json!({
        "cited_pages": request.cited_pages.as_deref().unwrap_or(&[])
    })
    .to_string();

    sqlx::query(
        "INSERT INTO messages (id, chat_id, role, parts, metadata, created_at)
         VALUES (?, ?, 'user', ?, ?, ?)",
    )
    .bind(&user_message_id)
    .bind(&chat_id)
    .bind(&parts)
    .bind(&user_metadata_initial)
    .bind(&now)
    .execute(&db)
    .await?;

    on_event
        .send(ChatStreamEvent::UserMessageSaved {
            message_id: user_message_id.clone(),
        })
        .map_err(|e| ApiError::internal_error(e.to_string()))?;

    // 3 & 4. Query rewriting and RAG retrieval.
    //
    // Query rewriting is skipped when:
    //   - no aux credentials are available (unknown provider or missing API key), OR
    //   - there is no conversation history (rewriting gives zero benefit on the first message).
    //
    // When rewriting is enabled, we rewrite first and then retrieve with the improved query so
    // that co-reference resolution and keyword expansion actually improve retrieval quality.
    // When rewriting is skipped, we retrieve immediately with the original query.
    let has_history = !history.is_empty();
    let should_rewrite = aux_credentials.is_some() && has_history;

    let (rewritten_query, chunks) = if should_rewrite {
        // Rewrite first, then retrieve with the better query
        let aux = aux_credentials.as_ref().unwrap();
        let rewritten = rag::rewrite_query_streaming(
            &user_message,
            &history,
            &aux.model,
            &aux.api_key,
            aux.base_url_override.clone(),
        )
        .await
        .unwrap_or_else(|e| {
            log::warn!("Query rewriting failed: {}, using original query", e);
            user_message.clone()
        });
        let chunks = rag::retrieve_chunks(&rewritten, &document_id, &db, 5).await;
        (rewritten, chunks)
    } else {
        if !has_history {
            log::info!("No prior history — skipping query rewriting on first message");
        } else {
            log::info!("No aux credentials — skipping query rewriting");
        }
        let chunks = rag::retrieve_chunks(&user_message, &document_id, &db, 5).await;
        (user_message.clone(), chunks)
    };
    let mut chunks = chunks.unwrap_or_else(|e| {
        log::warn!("RAG retrieval failed: {}, using empty chunks", e);
        vec![]
    });

    // Force-include chunks from explicitly cited pages (user's @page references).
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

    // Vision enhancement: replace cited-page text chunks with screenshots when the
    // model supports image inputs. Screenshots provide full visual context (tables,
    // figures, layout) that plain text extraction cannot capture.
    let mut cited_screenshots: Vec<rag::context_builder::CitedPageScreenshot> = Vec::new();
    let supports_vision = if model == "local" || model.starts_with("local:") {
        local_model_supports_vision
    } else {
        crate::catalog::model_supports_vision(&request.model)
    };

    if supports_vision {
        if let Some(cited_pages) = &request.cited_pages {
            if !cited_pages.is_empty() {
                match db::embedding::get_screenshot_paths_for_pages(&db, &document_id, cited_pages)
                    .await
                {
                    Ok(screenshot_rows) => {
                        let mut screenshot_page_numbers = std::collections::HashSet::<i64>::new();

                        for (page_number, screenshot_path) in &screenshot_rows {
                            if let Some(data_uri) =
                                rag::context_builder::load_screenshot_as_data_uri(
                                    &state.app_data_dir,
                                    screenshot_path,
                                )
                            {
                                screenshot_page_numbers.insert(*page_number);
                                cited_screenshots.push(rag::context_builder::CitedPageScreenshot {
                                    page_number: *page_number as i32,
                                    data_uri,
                                });
                            }
                        }

                        // Remove text chunks for pages replaced by screenshots
                        if !screenshot_page_numbers.is_empty() {
                            chunks.retain(|c| !screenshot_page_numbers.contains(&c.page_number));
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to fetch screenshot paths: {}, falling back to text chunks",
                            e
                        );
                    }
                }
            }
        }
    }

    // 5. Build RAG context (rewritten query used as the final user message for the LLM)
    //
    // Capture chunk IDs here — after all cited-page merging and screenshot deduplication —
    // so both the user and assistant metadata record exactly what context was sent to the LLM.
    let rag_chunk_ids: Vec<String> = chunks.iter().map(|c| c.chunk_id.clone()).collect();

    // Backfill user message metadata now that we know the rewritten query and retrieved chunks.
    let user_metadata = serde_json::json!({
        "rewritten_query": rewritten_query,
        "rag_chunk_ids": rag_chunk_ids,
        "cited_pages": request.cited_pages.as_deref().unwrap_or(&[])
    })
    .to_string();

    sqlx::query("UPDATE messages SET metadata = ? WHERE id = ?")
        .bind(&user_metadata)
        .bind(&user_message_id)
        .execute(&db)
        .await?;

    let final_query =
        annotate_query_with_cited_pages(&rewritten_query, request.cited_pages.as_deref());

    let rag_messages =
        rag::build_rag_context(&chunks, &history, &final_query, 3, &cited_screenshots);

    // 6. Stream from LLM
    let stream_start = std::time::Instant::now();

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

    let latency_ms = stream_start.elapsed().as_millis() as i64;

    // 7. Save assistant message
    let assistant_message_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let assistant_parts = serde_json::json!([{"type": "text", "text": full_response}]).to_string();

    let assistant_metadata = serde_json::json!({
        "model": credentials.model,
        "provider": get_provider_name(&model),
        "rag_chunk_ids": rag_chunk_ids,
        "latency_ms": latency_ms
    })
    .to_string();

    sqlx::query(
        "INSERT INTO messages (id, chat_id, role, parts, metadata, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?)",
    )
    .bind(&assistant_message_id)
    .bind(&chat_id)
    .bind(&assistant_parts)
    .bind(&assistant_metadata)
    .bind(&now)
    .execute(&db)
    .await?;

    on_event
        .send(ChatStreamEvent::Done {
            message_id: assistant_message_id,
        })
        .map_err(|e| ApiError::internal_error(e.to_string()))?;

    // 8. Trigger title generation if this is the first exchange (background task).
    let message_count = db::chat::count_messages(&db, &chat_id).await.unwrap_or(0);

    if message_count == 2 {
        // First exchange
        if let Some(aux) = aux_credentials {
            let db_clone = db.clone();
            let chat_id_clone = chat_id.clone();
            let on_event_clone = on_event.clone();

            tauri::async_runtime::spawn(async move {
                match generate_chat_title(&db_clone, &chat_id_clone, &aux).await {
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
            log::info!("No aux credentials — skipping title generation");
        }
    }

    Ok(())
}

async fn generate_chat_title(
    db: &sqlx::SqlitePool,
    chat_id: &str,
    aux: &ModelCredentials,
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
        rag::query_rewriter::Message::text("system", &rag::prompts::title_system_prompt()),
        rag::query_rewriter::Message::text("user", &title_context),
    ];

    // Generate title
    log::info!(
        "[generate_chat_title] Calling llm::generate_title for chat_id={}",
        chat_id
    );

    let title = llm::generate_title(
        title_messages,
        aux.model.clone(),
        aux.api_key.clone(),
        aux.base_url_override.clone(),
    )
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
