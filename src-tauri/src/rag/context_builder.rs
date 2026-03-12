use super::prompts::{build_document_context_message, CHAT_RESPONSE_SYSTEM_PROMPT};
use super::query_rewriter::Message;
use super::retriever::RetrievedChunk;

/// Build RAG context messages for LLM
/// Returns a Vec of messages: [system, context, history..., user_query]
pub fn build_rag_context(
    chunks: &[RetrievedChunk],
    history: &[Message], // Recent conversation history
    user_query: &str,
    max_history_turns: usize, // e.g., 5 turns = 10 messages
) -> Vec<Message> {
    let mut messages = Vec::new();

    // 1. System message
    let system_message = Message {
        role: "system".to_string(),
        content: CHAT_RESPONSE_SYSTEM_PROMPT.to_string(),
    };
    messages.push(system_message);

    // 2. RAG context message (legacy format)
    let context_message = Message {
        role: "user".to_string(),
        content: build_document_context_message(chunks),
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
    let user_message = Message {
        role: "user".to_string(),
        content: user_query.to_string(),
    };
    messages.push(user_message);

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
        let history = vec![Message {
            role: "assistant".to_string(),
            content: "Previous answer".to_string(),
        }];

        let messages = build_rag_context(&chunks, &history, "Explain again", 5);

        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[0].content, CHAT_RESPONSE_SYSTEM_PROMPT);
        assert_eq!(messages[1].role, "user");
        assert!(messages[1].content.contains("<document_context>"));
        assert!(messages[1]
            .content
            .contains("<page id=\"12\" chunk=\"0\">"));
        assert_eq!(messages[2].role, "assistant");
        assert_eq!(messages[3].role, "user");
        assert_eq!(messages[3].content, "Explain again");
    }
}
