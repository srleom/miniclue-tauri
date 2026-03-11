use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub api_keys: HashMap<String, String>,
    #[serde(default)]
    pub model_preferences: HashMap<String, HashMap<String, bool>>,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default)]
    pub custom_providers: Vec<CustomProvider>,
    #[serde(skip)]
    pub config_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    /// Whether the local chat model is enabled (downloaded and configured).
    /// Kept for backward-compatibility; the authoritative list is `local_chat_enabled_models`.
    #[serde(default)]
    pub local_chat_enabled: bool,
    /// Absolute path to the local chat model GGUF file, if set.
    /// Still used by the llama-server startup logic to know which file to load.
    #[serde(default)]
    pub local_chat_model_path: Option<String>,
    /// ID of the model the llama-server was last started with (e.g. "qwen3-4b-q4").
    #[serde(default)]
    pub local_chat_model_id: Option<String>,
    /// Set of model IDs that the user has enabled for the chat model selector.
    /// Each downloaded model can be independently added/removed here.
    #[serde(default)]
    pub local_chat_enabled_models: Vec<String>,
}

impl AppConfig {
    pub fn load(app_data_dir: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let config_path = app_data_dir.join("config.json");

        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let mut config: AppConfig = serde_json::from_str(&content)?;
            config.config_path = config_path;
            Ok(config)
        } else {
            let config = AppConfig {
                api_keys: HashMap::new(),
                model_preferences: HashMap::new(),
                settings: AppSettings::default(),
                custom_providers: Vec::new(),
                config_path: config_path.clone(),
            };
            config.save()?;
            Ok(config)
        }
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(&self.config_path, content)?;
        Ok(())
    }

    /// Creates a backup copy of the current configuration for rollback purposes
    pub fn backup(&self) -> Self {
        self.clone()
    }

    /// Restores configuration from a backup
    pub fn restore(&mut self, backup: &AppConfig) {
        self.api_keys = backup.api_keys.clone();
        self.model_preferences = backup.model_preferences.clone();
        self.settings = backup.settings.clone();
        self.custom_providers = backup.custom_providers.clone();
    }

    pub fn get_api_key(&self, provider: &str) -> Option<&String> {
        self.api_keys.get(provider)
    }

    #[allow(dead_code)]
    pub fn set_api_key(&mut self, provider: String, api_key: String) {
        self.api_keys.insert(provider, api_key);
    }

    #[allow(dead_code)]
    pub fn remove_api_key(&mut self, provider: &str) -> Option<String> {
        self.api_keys.remove(provider)
    }

    pub fn has_api_key(&self, provider: &str) -> bool {
        self.api_keys.contains_key(provider)
    }

    pub fn get_model_preference(&self, provider: &str, model: &str) -> bool {
        self.model_preferences
            .get(provider)
            .and_then(|models| models.get(model).copied())
            .unwrap_or(false)
    }

    pub fn set_model_preference(&mut self, provider: &str, model: &str, enabled: bool) {
        self.model_preferences
            .entry(provider.to_string())
            .or_default()
            .insert(model.to_string(), enabled);
    }

    pub fn init_default_models(&mut self, provider: &str, models: &[&str]) {
        let provider_prefs = self
            .model_preferences
            .entry(provider.to_string())
            .or_default();

        for &model in models {
            provider_prefs.insert(model.to_string(), true);
        }
    }

    /// Get a custom provider by id
    pub fn get_custom_provider(&self, id: &str) -> Option<&CustomProvider> {
        self.custom_providers.iter().find(|p| p.id == id)
    }

    /// Add or replace a custom provider (upsert by id)
    pub fn add_custom_provider(&mut self, provider: CustomProvider) {
        if let Some(existing) = self
            .custom_providers
            .iter_mut()
            .find(|p| p.id == provider.id)
        {
            *existing = provider;
        } else {
            self.custom_providers.push(provider);
        }
    }

    /// Remove a custom provider by id, returns true if removed
    pub fn remove_custom_provider(&mut self, id: &str) -> bool {
        let len_before = self.custom_providers.len();
        self.custom_providers.retain(|p| p.id != id);
        self.custom_providers.len() < len_before
    }
}
