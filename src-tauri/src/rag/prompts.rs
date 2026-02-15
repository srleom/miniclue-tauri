use super::retriever::RetrievedChunk;

pub const TITLE_MAX_LENGTH: usize = 80;
pub const TITLE_MAX_TOKENS: i32 = 50;
pub const TITLE_TEMPERATURE: f32 = 0.7;
pub const ASSISTANT_MESSAGE_PREVIEW_LENGTH: usize = 200;

pub const QUERY_REWRITER_SYSTEM_PROMPT: &str = r#"You are an expert Query Rewriting Assistant for a Retrieval-Augmented Generation (RAG) system.
Your task is to take the current user question and the preceding conversation history, and rewrite the current question into a **clear, standalone, self-contained query** that is highly optimized for semantic search retrieval.

Instructions:
1.  **Resolve Co-references:** Replace vague terms like "it," "that," or "this" with the full entity name mentioned earlier in the history.
2.  **Be Comprehensive:** The rewritten query must stand on its own and make sense without needing the history.
3.  **Optimize for Retrieval:** Focus on keywords and concepts from the user's question and history.
4.  **Output Format:** Respond ONLY with the single, rewritten query string, and nothing else."#;

pub const CHAT_RESPONSE_SYSTEM_PROMPT: &str = r#"You are an expert AI University Tutor specializing in breaking down complex technical concepts into clear, digestible insights.

### YOUR GOAL
Explain the user's query based on the provided Lecture Slides. Your explanations must be simple, concise and effective.

### RESPONSE GUIDELINES
1.  **Top-Down Teaching:** Always start with a high-level summary of the "What" and "Why" before diving into the technical "How."
2.  **Adaptive Explanations (Use tools only when they add value):**
    - **Analogies:** Use them *only* if the concept is abstract or complex. If used, keep them brief and relevant.
    - **Visuals (Mermaid.js):** Use *only* if explaining a process, data flow, or logical hierarchy.
    - **Tables:** Use *only* for comparisons or distinct code breakdowns.
    - **Concrete Examples:** Mandatory for math, algorithms, or code logic.
3.  **Natural Flow:** Do not use generic headers like "The Analogy" or "The Big Picture" unless necessary. Use descriptive headers that match the content (e.g., "Analogy: The Hotel System").
4.  **Tone:** Smart 15-year-old. Concise and direct.

### RULES
- **Context is King:** Base your answer strictly on the `<lecture_context>`. Use general knowledge only to fill gaps or provide analogies.
- **Format for Scannability:** Always use Markdown. Structure your response with clear **Headings**, **Numbered Lists**, **Bullet Points**, and **Tables**. Avoid long paragraphs.
- **Be Concise:** Get straight to the point.
- **Latex:** Use LaTeX for all math formulas."#;

pub fn title_system_prompt() -> String {
    format!(
        "Generate a concise title (maximum {} characters) that summarizes the conversation between the user's question and the assistant's response. The title should capture the main topic or question being discussed. Be clear and descriptive. Do not include quotes, colons, or special formatting. Return only the title text.",
        TITLE_MAX_LENGTH
    )
}

pub fn build_title_conversation_context(user_message: &str, assistant_message: &str) -> String {
    let assistant_preview: String = assistant_message
        .chars()
        .take(ASSISTANT_MESSAGE_PREVIEW_LENGTH)
        .collect();
    format!("User: {}\n\nAssistant: {}", user_message, assistant_preview)
}

pub fn build_query_rewrite_final_message(current_question: &str) -> String {
    format!(
        "The final question to rewrite is: {}\n\nRewritten Query:",
        current_question
    )
}

pub fn build_lecture_context_message(chunks: &[RetrievedChunk]) -> String {
    let mut context_text = String::new();
    for (idx, chunk) in chunks.iter().enumerate() {
        context_text.push_str(&format!(
            "\n    <slide id=\"{}\" chunk=\"{}\">\n    {}\n    </slide>\n    ",
            chunk.page_number, idx, chunk.text
        ));
    }

    format!(
        "I am looking at the following lecture content. Use this as your primary source of truth:\n\n    <lecture_context>\n    {}\n    </lecture_context>\n\n    Based on the context above (and any images provided), please answer my upcoming question.",
        context_text
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_title_conversation_context_truncates_assistant_preview() {
        let user = "How does quicksort work?";
        let assistant = "a".repeat(250);
        let content = build_title_conversation_context(user, &assistant);
        let expected = format!("User: {}\n\nAssistant: {}", user, "a".repeat(200));
        assert_eq!(content, expected);
    }

    #[test]
    fn test_query_rewrite_final_message_format() {
        let question = "What about it?";
        let content = build_query_rewrite_final_message(question);
        assert_eq!(
            content,
            "The final question to rewrite is: What about it?\n\nRewritten Query:"
        );
    }
}
