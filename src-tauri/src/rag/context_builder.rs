use std::path::Path;

use super::prompts::{build_document_context_message, CHAT_RESPONSE_SYSTEM_PROMPT};
use super::query_rewriter::{ContentPart, ImageUrl, Message, MessageContent};
use super::retriever::RetrievedChunk;

pub struct CitedPageScreenshot {
    pub page_number: i32,
    pub data_uri: String,
}

/// Load a screenshot from disk and return it as a base64-encoded JPEG data URI.
/// Returns `None` if the file cannot be read.
pub fn load_screenshot_as_data_uri(app_data_dir: &Path, relative_path: &str) -> Option<String> {
    use base64::Engine;
    let full_path = app_data_dir.join(relative_path);
    match std::fs::read(&full_path) {
        Ok(bytes) => {
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Some(format!("data:image/jpeg;base64,{}", encoded))
        }
        Err(e) => {
            log::warn!("Failed to load screenshot {}: {}", full_path.display(), e);
            None
        }
    }
}

fn build_document_context_parts(
    chunks: &[RetrievedChunk],
    cited_screenshots: &[CitedPageScreenshot],
) -> Vec<ContentPart> {
    let mut parts = Vec::new();

    // 1. Text part: intro + XML document context with remaining text chunks
    let mut context_text = String::new();
    for (idx, chunk) in chunks.iter().enumerate() {
        context_text.push_str(&format!(
            "\n    <page id=\"{}\" chunk=\"{}\">\n    {}\n    </page>\n    ",
            chunk.page_number, idx, chunk.text
        ));
    }
    let intro = format!(
        "I am looking at the following document content. Use this as your primary source of truth:\n\n    <document_context>\n    {}\n    </document_context>",
        context_text
    );
    parts.push(ContentPart::Text { text: intro });

    // 2. Screenshot parts: label + image for each cited page
    for screenshot in cited_screenshots {
        parts.push(ContentPart::Text {
            text: format!("Page {} of the document:", screenshot.page_number),
        });
        parts.push(ContentPart::ImageUrl {
            image_url: ImageUrl {
                url: screenshot.data_uri.clone(),
            },
        });
    }

    // 3. Closing instruction
    parts.push(ContentPart::Text {
        text: "Based on the context above (and any images provided), please answer my upcoming question.".to_string(),
    });

    parts
}

/// Build RAG context messages for LLM.
/// Returns a Vec of messages: [system, context, history..., user_query]
///
/// When `cited_screenshots` is non-empty, the context message is multimodal
/// (text + images). Otherwise it is a plain text message.
pub fn build_rag_context(
    chunks: &[RetrievedChunk],
    history: &[Message],
    user_query: &str,
    max_history_turns: usize,
    cited_screenshots: &[CitedPageScreenshot],
) -> Vec<Message> {
    let mut messages = Vec::new();

    // 1. System message
    messages.push(Message::text("system", CHAT_RESPONSE_SYSTEM_PROMPT));

    // 2. RAG context message — multimodal when screenshots are present
    let context_message = if cited_screenshots.is_empty() {
        Message::text("user", &build_document_context_message(chunks))
    } else {
        Message {
            role: "user".to_string(),
            content: MessageContent::Parts(build_document_context_parts(chunks, cited_screenshots)),
        }
    };
    messages.push(context_message);

    // 3. Conversation history (last N turns)
    let history_messages: Vec<Message> = history
        .iter()
        .rev()
        .take(max_history_turns * 2) // 2 messages per turn
        .rev()
        .cloned()
        .collect();
    messages.extend(history_messages);

    // 4. Current user query
    messages.push(Message::text("user", user_query));

    messages
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_rag_context_uses_legacy_prompt_and_context_shape() {
        let chunks = vec![RetrievedChunk {
            chunk_id: "c1".to_string(),
            text: "Binary search runs in O(log n).".to_string(),
            page_number: 12,
            distance: 0.1,
        }];
        let history = vec![Message::text("assistant", "Previous answer")];

        let messages = build_rag_context(&chunks, &history, "Explain again", 5, &[]);

        assert_eq!(messages[0].role, "system");
        assert_eq!(
            messages[0].content.as_text().unwrap(),
            CHAT_RESPONSE_SYSTEM_PROMPT
        );
        assert_eq!(messages[1].role, "user");
        assert!(messages[1]
            .content
            .as_text()
            .unwrap()
            .contains("<document_context>"));
        assert!(messages[1]
            .content
            .as_text()
            .unwrap()
            .contains("<page id=\"12\" chunk=\"0\">"));
        assert_eq!(messages[2].role, "assistant");
        assert_eq!(messages[3].role, "user");
        assert_eq!(messages[3].content.as_text().unwrap(), "Explain again");
    }

    #[test]
    fn test_build_rag_context_multimodal_with_screenshots() {
        let chunks = vec![RetrievedChunk {
            chunk_id: "c1".to_string(),
            text: "Semantic result.".to_string(),
            page_number: 3,
            distance: 0.2,
        }];
        let screenshots = vec![CitedPageScreenshot {
            page_number: 5,
            data_uri: "data:image/jpeg;base64,abc123".to_string(),
        }];

        let messages = build_rag_context(&chunks, &[], "What is on page 5?", 3, &screenshots);

        // Context message should be multimodal Parts
        let context_msg = &messages[1];
        assert_eq!(context_msg.role, "user");
        match &context_msg.content {
            MessageContent::Parts(parts) => {
                // First part: text with document context
                let first_text = match &parts[0] {
                    ContentPart::Text { text } => text.as_str(),
                    _ => panic!("Expected text part first"),
                };
                assert!(first_text.contains("<document_context>"));
                assert!(first_text.contains("Semantic result."));

                // Second part: page label
                let label = match &parts[1] {
                    ContentPart::Text { text } => text.as_str(),
                    _ => panic!("Expected text label"),
                };
                assert!(label.contains("Page 5"));

                // Third part: image
                match &parts[2] {
                    ContentPart::ImageUrl { image_url } => {
                        assert_eq!(image_url.url, "data:image/jpeg;base64,abc123");
                    }
                    _ => panic!("Expected image_url part"),
                }
            }
            MessageContent::Text(_) => panic!("Expected Parts, got Text"),
        }
    }
}
