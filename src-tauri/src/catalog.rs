/// Per-provider model catalog.
/// Each entry is `(model_id, display_name, supports_vision)`.
/// This is the single source of truth for available models and their capabilities.
pub type ModelEntry = (&'static str, &'static str, bool);

lazy_static::lazy_static! {
    pub static ref MODEL_CATALOG: std::collections::HashMap<&'static str, Vec<ModelEntry>> = {
        let mut m = std::collections::HashMap::new();
        m.insert("openai", vec![
            ("gpt-5.4", "GPT-5.4", true),
            ("gpt-5.3-chat-latest", "GPT-5.3 chat latest", true),
            ("gpt-5.2", "GPT-5.2", true),
            ("gpt-5.2-chat-latest", "GPT-5.2 chat latest", true),
            ("gpt-5.1", "GPT-5.1", true),
            ("gpt-5.1-chat-latest", "GPT-5.1 chat latest", true),
            ("gpt-5", "GPT-5", true),
            ("gpt-5-chat-latest", "GPT-5 chat latest", true),
            ("gpt-5-mini", "GPT-5 mini", true),
            ("gpt-5-nano", "GPT-5 nano", true),
            ("gpt-4.1", "GPT-4.1", true),
            ("gpt-4.1-mini", "GPT-4.1 mini", true),
            ("gpt-4.1-nano", "GPT-4.1 nano", true),
            ("gpt-4o", "GPT-4o", true),
            ("gpt-4o-mini", "GPT-4o mini", true),
        ]);
        m.insert("gemini", vec![
            ("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", true),
            ("gemini-3-flash-preview", "Gemini 3 Flash Preview", true),
            ("gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite Preview", true),
        ]);
        m.insert("anthropic", vec![
            ("claude-sonnet-4-5", "Claude Sonnet 4.5", true),
            ("claude-haiku-4-5", "Claude Haiku 4.5", true),
        ]);
        m.insert("xai", vec![
            ("grok-4-1-fast-reasoning", "Grok 4.1 Fast (Reasoning)", true),
            ("grok-4-1-fast-non-reasoning", "Grok 4.1 Fast (Non-reasoning)", true),
        ]);
        m.insert("deepseek", vec![
            ("deepseek-chat", "DeepSeek-V3.2 (Non-thinking Mode)", false),
            ("deepseek-reasoner", "DeepSeek-V3.2 (Thinking Mode)", false),
        ]);
        m
    };

    /// Default models enabled when a user first adds an API key for a provider.
    pub static ref DEFAULT_MODELS: std::collections::HashMap<&'static str, Vec<&'static str>> = {
        let mut m = std::collections::HashMap::new();
        m.insert("openai", vec!["gpt-5.1", "gpt-4.1", "gpt-4.1-mini"]);
        m.insert("gemini", vec!["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"]);
        m.insert("anthropic", vec!["claude-sonnet-4-5", "claude-haiku-4-5"]);
        m.insert("xai", vec!["grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning"]);
        m.insert("deepseek", vec!["deepseek-chat", "deepseek-reasoner"]);
        m
    };
}

/// Returns `true` if the given model ID supports vision (image inputs).
/// Falls back to `false` for unknown model IDs (custom/local providers).
pub fn model_supports_vision(model_id: &str) -> bool {
    MODEL_CATALOG
        .values()
        .flat_map(|models| models.iter())
        .find(|(id, _, _)| *id == model_id)
        .map(|(_, _, vision)| *vision)
        .unwrap_or(false)
}
