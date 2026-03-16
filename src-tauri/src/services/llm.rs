use async_stream::stream;
use futures::Stream;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::time::Duration;
use thiserror::Error;

use crate::rag::prompts::{TITLE_MAX_TOKENS, TITLE_TEMPERATURE};

pub use crate::rag::query_rewriter::Message;

#[derive(Error, Debug)]
#[allow(clippy::enum_variant_names)]
pub enum LlmError {
    #[error("API request failed: {0}")]
    ApiError(String),
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("Invalid response format: {0}")]
    ParseError(String),
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<i32>,
    stream: bool,
    /// llama-server / Qwen3: disable the thinking (chain-of-thought) phase so
    /// the model responds immediately without emitting <think>…</think> tokens.
    /// Only sent when targeting the local llama-server endpoint.
    #[serde(skip_serializing_if = "Option::is_none")]
    chat_template_kwargs: Option<serde_json::Value>,
}

#[allow(unused_variables)]
fn log_request_payload(label: &str, url: &str, request: &ChatRequest) {
    #[cfg(debug_assertions)]
    {
        match serde_json::to_string_pretty(request) {
            Ok(payload) => {
                log::info!("[llm:{}] POST {}\n{}", label, url, payload);
            }
            Err(e) => {
                log::warn!(
                    "[llm:{}] Failed to serialize request payload for logging: {}",
                    label,
                    e
                );
            }
        }
    }
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    #[serde(default)]
    delta: Option<Delta>,
}

#[derive(Deserialize)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
}

/// Provider-specific base URLs
pub fn get_provider_base_url(model: &str) -> &'static str {
    if model.starts_with("gemini") || model.starts_with("models/gemini") {
        "https://generativelanguage.googleapis.com/v1beta/openai"
    } else if model.starts_with("gpt") || model.starts_with("o1") {
        "https://api.openai.com/v1"
    } else if model.starts_with("claude") {
        "https://api.anthropic.com/v1"
    } else if model.starts_with("grok") {
        "https://api.x.ai/v1"
    } else if model.starts_with("deepseek") {
        "https://api.deepseek.com"
    } else {
        // Default to OpenAI-compatible
        "https://api.openai.com/v1"
    }
}

/// Stream chat completion from OpenAI-compatible endpoint
pub async fn stream_chat(
    messages: Vec<Message>,
    model: String,
    api_key: String,
    base_url_override: Option<String>,
) -> Result<Pin<Box<dyn Stream<Item = Result<String, LlmError>> + Send>>, LlmError> {
    stream_chat_with_options(messages, model, api_key, Some(0.7), None, base_url_override).await
}

async fn stream_chat_with_options(
    messages: Vec<Message>,
    model: String,
    api_key: String,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    base_url_override: Option<String>,
) -> Result<Pin<Box<dyn Stream<Item = Result<String, LlmError>> + Send>>, LlmError> {
    // Use only a connection timeout — no total/read timeout — so that slow local
    // models generating long responses are not killed mid-stream.
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| LlmError::NetworkError(e.to_string()))?;

    let base_url = match base_url_override {
        Some(ref url) => url.as_str().trim_end_matches('/').to_string(),
        None => get_provider_base_url(&model).to_string(),
    };
    let url = format!("{}/chat/completions", base_url);

    // For local llama-server endpoints disable the Qwen3 thinking phase so
    // responses arrive without a lengthy <think>…</think> prefix.
    let is_local = base_url.starts_with("http://127.0.0.1:");
    let chat_template_kwargs = if is_local {
        Some(serde_json::json!({"enable_thinking": false}))
    } else {
        None
    };

    let request = ChatRequest {
        model,
        messages,
        temperature,
        max_tokens,
        stream: true,
        chat_template_kwargs,
    };

    log_request_payload("stream_chat", &url, &request);

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| LlmError::NetworkError(e.to_string()))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(LlmError::ApiError(format!("LLM API error: {}", error_text)));
    }

    // Create stream from response bytes
    let stream = stream! {
        use futures::StreamExt;

        let mut byte_stream = response.bytes_stream();

        // Line-oriented buffer. We process on every '\n' so each SSE data line is
        // dispatched as soon as it arrives — without waiting for the '\n\n' event
        // boundary. This eliminates the one-token delay that was caused by buffering
        // until the *next* event arrived before yielding the *current* one.
        let mut buffer = String::new();

        'outer: while let Some(chunk_result) = byte_stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    let text = match std::str::from_utf8(&bytes) {
                        Ok(t) => t,
                        Err(e) => {
                            yield Err(LlmError::ParseError(e.to_string()));
                            continue;
                        }
                    };

                    buffer.push_str(text);

                    // Process every complete line (ending with '\n') immediately.
                    while let Some(newline_pos) = buffer.find('\n') {
                        let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                        buffer = buffer[newline_pos + 1..].to_string();

                        if let Some(data) = line.strip_prefix("data: ") {
                            if data.trim() == "[DONE]" {
                                break 'outer;
                            }

                            match serde_json::from_str::<ChatResponse>(data) {
                                Ok(response) => {
                                    if let Some(choice) = response.choices.first() {
                                        if let Some(delta) = &choice.delta {
                                            if let Some(content) = &delta.content {
                                                if !content.is_empty() {
                                                    yield Ok(content.clone());
                                                }
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::error!("[stream_chat] Failed to parse SSE chunk: {}", e);
                                    log::debug!("[stream_chat] Problematic line: {}", data);
                                }
                            }
                        }
                        // Empty lines (\n\n event boundaries) and comment lines are
                        // silently skipped — no special handling needed.
                    }
                }
                Err(e) => {
                    yield Err(LlmError::NetworkError(e.to_string()));
                    return;
                }
            }
        }
    };

    Ok(Box::pin(stream))
}

/// Generate chat title using the provided model and API key.
pub async fn generate_title(
    messages: Vec<Message>,
    model: String,
    api_key: String,
    base_url_override: Option<String>,
) -> Result<String, LlmError> {
    use futures::StreamExt;

    // Use existing streaming parser for robustness
    let mut stream = stream_chat_with_options(
        messages,
        model,
        api_key,
        Some(TITLE_TEMPERATURE),
        Some(TITLE_MAX_TOKENS),
        base_url_override,
    )
    .await?;

    let mut title = String::new();

    // Accumulate chunks with timeout (30s for title vs 60s for chat)
    let timeout = tokio::time::Duration::from_secs(30);
    let accumulate = async {
        let mut chunk_count = 0;
        while let Some(result) = stream.next().await {
            match result {
                Ok(content) => {
                    chunk_count += 1;
                    log::debug!("[generate_title] Chunk {}: '{}'", chunk_count, content);
                    title.push_str(&content);
                }
                Err(e) => {
                    log::error!("[generate_title] Stream error: {}", e);
                    return Err(e);
                }
            }
        }
        log::info!(
            "[generate_title] Accumulated {} chunks, total length: {}",
            chunk_count,
            title.len()
        );
        Ok(title)
    };

    let title = tokio::time::timeout(timeout, accumulate)
        .await
        .map_err(|_| LlmError::ApiError("Title generation timeout".to_string()))??;

    Ok(title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_response_parsing_ignores_unknown_choice_fields() {
        let data = r#"{
            "choices": [
                {
                    "index": 0,
                    "delta": { "content": "Hello" },
                    "message": { "role": "assistant", "content": "Unused full message" },
                    "finish_reason": "stop"
                }
            ]
        }"#;

        let response: ChatResponse =
            serde_json::from_str(data).expect("SSE chunk with extra fields should parse");
        let content = response.choices[0]
            .delta
            .as_ref()
            .and_then(|delta| delta.content.as_deref());

        assert_eq!(content, Some("Hello"));
    }
}
