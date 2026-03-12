use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::prompts::{build_query_rewrite_final_message, QUERY_REWRITER_SYSTEM_PROMPT};

#[derive(Error, Debug)]
pub enum QueryRewriterError {
    #[error("API request failed: {0}")]
    ApiError(String),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

impl MessageContent {
    #[allow(dead_code)]
    pub fn as_text(&self) -> Option<&str> {
        match self {
            MessageContent::Text(s) => Some(s.as_str()),
            MessageContent::Parts(_) => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrl },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImageUrl {
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    pub role: String,
    pub content: MessageContent,
}

impl Message {
    pub fn text(role: &str, content: &str) -> Self {
        Self {
            role: role.to_string(),
            content: MessageContent::Text(content.to_string()),
        }
    }
}

fn build_rewrite_messages(original_query: &str, history: &[Message]) -> Vec<Message> {
    let context_messages: Vec<Message> = history.iter().rev().take(6).rev().cloned().collect();

    let mut messages = Vec::with_capacity(context_messages.len() + 2);
    messages.push(Message::text("system", QUERY_REWRITER_SYSTEM_PROMPT));
    messages.extend(context_messages);
    messages.push(Message::text(
        "user",
        &build_query_rewrite_final_message(original_query),
    ));

    messages
}

/// Rewrite a user query using the provided model and API key.
pub async fn rewrite_query_streaming(
    original_query: &str,
    history: &[Message],
    model: &str,
    api_key: &str,
    base_url_override: Option<String>,
) -> Result<String, QueryRewriterError> {
    use futures::StreamExt;

    // Use streaming parser
    let messages = build_rewrite_messages(original_query, history);
    let mut stream = crate::services::llm::stream_chat(
        messages,
        model.to_string(),
        api_key.to_string(),
        base_url_override,
    )
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
            Message::text("assistant", "Message 1"),
            Message::text("user", "Message 2"),
            Message::text("assistant", "Message 3"),
            Message::text("user", "Message 4"),
            Message::text("assistant", "Message 5"),
            Message::text("user", "Message 6"),
            Message::text("assistant", "Message 7"),
        ];

        let messages = build_rewrite_messages("What about that?", &history);

        assert_eq!(messages[0].role, "system");
        assert_eq!(
            messages[0].content.as_text().unwrap(),
            QUERY_REWRITER_SYSTEM_PROMPT
        );
        assert_eq!(messages.len(), 8);
        assert_eq!(messages[1].content.as_text().unwrap(), "Message 2");
        assert_eq!(messages[6].content.as_text().unwrap(), "Message 7");
        assert_eq!(
            messages[7].content.as_text().unwrap(),
            "The question to rewrite is: What about that?"
        );
    }

    #[test]
    fn test_message_content_serialization() {
        let text_msg = Message::text("user", "hello");
        let json = serde_json::to_string(&text_msg).unwrap();
        assert!(json.contains("\"content\":\"hello\""));

        let parts_msg = Message {
            role: "user".to_string(),
            content: MessageContent::Parts(vec![
                ContentPart::Text {
                    text: "hello".to_string(),
                },
                ContentPart::ImageUrl {
                    image_url: ImageUrl {
                        url: "data:image/jpeg;base64,abc".to_string(),
                    },
                },
            ]),
        };
        let json = serde_json::to_string(&parts_msg).unwrap();
        assert!(json.contains("\"content\":["));
        assert!(json.contains("\"type\":\"text\""));
        assert!(json.contains("\"type\":\"image_url\""));
    }
}
