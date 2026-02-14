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
        content: "You are an expert AI University Tutor. Answer questions based on the provided document content. \
                  Be concise, accurate, and cite specific pages when relevant. \
                  If you don't know the answer based on the document content, say so."
            .to_string(),
    };
    messages.push(system_message);

    // 2. RAG context message (formatted as XML for clarity)
    if !chunks.is_empty() {
        let mut context_content = String::from("<document_context>\n");
        for chunk in chunks {
            context_content.push_str(&format!(
                "<chunk page=\"{}\">\n{}\n</chunk>\n",
                chunk.page_number, chunk.text
            ));
        }
        context_content.push_str("</document_context>");

        let context_message = Message {
            role: "system".to_string(),
            content: context_content,
        };
        messages.push(context_message);
    }

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
