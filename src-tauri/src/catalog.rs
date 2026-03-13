/// Per-provider model catalog.
/// Each entry is `(model_id, display_name, supports_vision)`.
/// This is the single source of truth for available models and their capabilities.
pub type ModelEntry = (&'static str, &'static str, bool);

lazy_static::lazy_static! {
    pub static ref MODEL_CATALOG: std::collections::HashMap<&'static str, Vec<ModelEntry>> = {
        let mut m = std::collections::HashMap::new();
        m.insert("openai", vec![
            ("gpt-4.1", "GPT-4.1", true),
            ("gpt-4.1-mini", "GPT-4.1 mini", true),
            ("gpt-4.1-nano", "GPT-4.1 nano", true),
            ("gpt-4o", "GPT-4o", true),
            ("gpt-4o-mini", "GPT-4o mini", true),
        ]);
        m.insert("gemini", vec![
            ("gemini-2.5-pro-preview-06-05", "Gemini 2.5 Pro", true),
            ("gemini-2.5-flash-preview-05-20", "Gemini 2.5 Flash", true),
            ("gemini-2.0-flash", "Gemini 2.0 Flash", true),
            ("gemini-2.0-flash-lite", "Gemini 2.0 Flash Lite", true),
        ]);
        m.insert("anthropic", vec![
            ("claude-opus-4-5", "Claude Opus 4.5", true),
            ("claude-sonnet-4-5", "Claude Sonnet 4.5", true),
            ("claude-haiku-4-5", "Claude Haiku 4.5", true),
        ]);
        m.insert("xai", vec![
            ("grok-3", "Grok 3", true),
            ("grok-3-fast", "Grok 3 Fast", true),
            ("grok-3-mini", "Grok 3 Mini", false),
            ("grok-3-mini-fast", "Grok 3 Mini Fast", false),
        ]);
        m.insert("deepseek", vec![
            ("deepseek-chat", "DeepSeek V3 (Chat)", false),
            ("deepseek-reasoner", "DeepSeek R1 (Reasoner)", false),
        ]);
        m
    };

    /// Default models enabled when a user first adds an API key for a provider.
    pub static ref DEFAULT_MODELS: std::collections::HashMap<&'static str, Vec<&'static str>> = {
        let mut m = std::collections::HashMap::new();
        m.insert("openai", vec!["gpt-4.1", "gpt-4.1-mini", "gpt-4o"]);
        m.insert("gemini", vec!["gemini-2.5-flash-preview-05-20", "gemini-2.0-flash", "gemini-2.5-pro-preview-06-05"]);
        m.insert("anthropic", vec!["claude-sonnet-4-5", "claude-haiku-4-5"]);
        m.insert("xai", vec!["grok-3", "grok-3-fast"]);
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
