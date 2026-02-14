use async_stream::stream;
use futures::Stream;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::time::Duration;
use thiserror::Error;

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
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    #[serde(default)]
    delta: Option<Delta>,
    #[serde(default)]
    message: Option<Message>,
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
) -> Result<Pin<Box<dyn Stream<Item = Result<String, LlmError>> + Send>>, LlmError> {
    // Create client with timeout (60 seconds for streaming)
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| LlmError::NetworkError(e.to_string()))?;

    let base_url = get_provider_base_url(&model);
    let url = format!("{}/chat/completions", base_url);

    let request = ChatRequest {
        model,
        messages,
        temperature: Some(0.7),
        max_tokens: None,
        stream: true,
    };

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

        let mut buffer = String::new();

        while let Some(chunk_result) = byte_stream.next().await {
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

                    // Process complete SSE events (lines ending with \n\n)
                    while let Some(event_end) = buffer.find("\n\n") {
                        let event = buffer[..event_end].to_string();
                        buffer = buffer[event_end + 2..].to_string();

                        // Parse SSE format: "data: {...}"
                        for line in event.lines() {
                            if let Some(data) = line.strip_prefix("data: ") {
                                if data.trim() == "[DONE]" {
                                    return;
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
                                        log::warn!("Failed to parse SSE chunk: {}", e);
                                    }
                                }
                            }
                        }
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

/// Generate chat title (non-streaming)
pub async fn generate_title(
    messages: Vec<Message>,
    api_key: String,
    model: String,
) -> Result<String, LlmError> {
    let client = Client::new();
    let base_url = get_provider_base_url(&model);
    let url = format!("{}/chat/completions", base_url);

    let request = ChatRequest {
        model,
        messages,
        temperature: Some(0.7),
        max_tokens: Some(80),
        stream: false,
    };

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

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| LlmError::ParseError(e.to_string()))?;

    let title = chat_response
        .choices
        .first()
        .and_then(|c| c.message.as_ref())
        .map(|m| m.content.trim().to_string())
        .ok_or_else(|| LlmError::ParseError("No content in response".to_string()))?;

    Ok(title)
}
