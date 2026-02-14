use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum QueryRewriterError {
    #[error("API request failed: {0}")]
    ApiError(String),
    #[error("Network error: {0}")]
    NetworkError(String),
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    temperature: f32,
    max_tokens: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

/// Rewrite a user query to be standalone, incorporating conversation history
/// Uses the last 3 turns (6 messages) from history
pub async fn rewrite_query(
    original_query: &str,
    history: &[Message], // Last few messages from the conversation
    api_key: &str,
    model: &str,    // e.g., "gemini-2.0-flash-lite"
    base_url: &str, // Provider-specific base URL
) -> Result<String, QueryRewriterError> {
    let client = Client::new();

    // Take last 3 turns (6 messages) for context
    let context_messages: Vec<Message> = history.iter().rev().take(6).rev().cloned().collect();

    // Build system message
    let system_message = Message {
        role: "system".to_string(),
        content: "You are a helpful assistant that rewrites user questions to be standalone queries for semantic search. \
                  Given the conversation history and the user's question, rewrite the question to be self-contained \
                  without losing any important context. If the question is already standalone, return it as is."
            .to_string(),
    };

    // Build user message with history context
    let mut context_text = String::new();
    if !context_messages.is_empty() {
        context_text.push_str("Previous conversation:\n");
        for msg in &context_messages {
            context_text.push_str(&format!("{}: {}\n", msg.role, msg.content));
        }
        context_text.push('\n');
    }
    context_text.push_str(&format!("User's question: {}\n\n", original_query));
    context_text.push_str("Rewrite this question as a standalone search query (max 2 sentences):");

    let user_message = Message {
        role: "user".to_string(),
        content: context_text,
    };

    let request = ChatRequest {
        model: model.to_string(),
        messages: vec![system_message, user_message],
        temperature: 0.3,
        max_tokens: 100,
    };

    let url = format!("{}/chat/completions", base_url);

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| QueryRewriterError::NetworkError(e.to_string()))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(QueryRewriterError::ApiError(format!(
            "LLM API error: {}",
            error_text
        )));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| QueryRewriterError::ApiError(e.to_string()))?;

    let rewritten = chat_response
        .choices
        .first()
        .map(|c| c.message.content.trim().to_string())
        .unwrap_or_else(|| original_query.to_string());

    // Fallback to original if rewriting fails or returns empty
    if rewritten.is_empty() {
        Ok(original_query.to_string())
    } else {
        Ok(rewritten)
    }
}
