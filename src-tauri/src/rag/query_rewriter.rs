use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::prompts::{build_query_rewrite_final_message, QUERY_REWRITER_SYSTEM_PROMPT};

#[derive(Error, Debug)]
pub enum QueryRewriterError {
    #[error("API request failed: {0}")]
    ApiError(String),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    pub role: String,
    pub content: String,
}

fn build_rewrite_messages(original_query: &str, history: &[Message]) -> Vec<Message> {
    let context_messages: Vec<Message> = history.iter().rev().take(6).rev().cloned().collect();

    let mut messages = Vec::with_capacity(context_messages.len() + 2);
    messages.push(Message {
        role: "system".to_string(),
        content: QUERY_REWRITER_SYSTEM_PROMPT.to_string(),
    });
    messages.extend(context_messages);
    messages.push(Message {
        role: "user".to_string(),
        content: build_query_rewrite_final_message(original_query),
    });

    messages
}

/// Rewrite a user query using streaming endpoint with Gemini 2.5 Flash Lite
///
/// Note: Always uses Gemini 2.5 Flash Lite via streaming for reliable, fast,
/// and cost-effective query rewriting regardless of user's selected chat model.
pub async fn rewrite_query_streaming(
    original_query: &str,
    history: &[Message],
    api_key: &str,
) -> Result<String, QueryRewriterError> {
    use futures::StreamExt;

    // Always use Gemini 2.5 Flash Lite
    let model = "gemini-2.5-flash-lite".to_string();

    // Use streaming parser
    let messages = build_rewrite_messages(original_query, history);
    let mut stream = crate::services::llm::stream_chat(messages, model, api_key.to_string())
        .await
        .map_err(|e| QueryRewriterError::ApiError(e.to_string()))?;

    let mut rewritten = String::new();
    let timeout = tokio::time::Duration::from_secs(30);

    let accumulate = async {
        while let Some(result) = stream.next().await {
            match result {
                Ok(content) => rewritten.push_str(&content),
                Err(e) => return Err(QueryRewriterError::ApiError(e.to_string())),
            }
        }
        Ok(rewritten)
    };

    let rewritten = tokio::time::timeout(timeout, accumulate)
        .await
        .map_err(|_| QueryRewriterError::ApiError("Query rewrite timeout".to_string()))??;

    // Fallback to original if empty
    if rewritten.trim().is_empty() {
        Ok(original_query.to_string())
    } else {
        Ok(rewritten.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_rewrite_messages_matches_legacy_structure() {
        let history = vec![
            Message {
                role: "assistant".to_string(),
                content: "Message 1".to_string(),
            },
            Message {
                role: "user".to_string(),
                content: "Message 2".to_string(),
            },
            Message {
                role: "assistant".to_string(),
                content: "Message 3".to_string(),
            },
            Message {
                role: "user".to_string(),
                content: "Message 4".to_string(),
            },
            Message {
                role: "assistant".to_string(),
                content: "Message 5".to_string(),
            },
            Message {
                role: "user".to_string(),
                content: "Message 6".to_string(),
            },
            Message {
                role: "assistant".to_string(),
                content: "Message 7".to_string(),
            },
        ];

        let messages = build_rewrite_messages("What about that?", &history);

        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[0].content, QUERY_REWRITER_SYSTEM_PROMPT);
        assert_eq!(messages.len(), 8);
        assert_eq!(messages[1].content, "Message 2");
        assert_eq!(messages[6].content, "Message 7");
        assert_eq!(
            messages[7].content,
            "The final question to rewrite is: What about that?\n\nRewritten Query:"
        );
    }
}
