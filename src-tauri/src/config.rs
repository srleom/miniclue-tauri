use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub api_keys: HashMap<String, String>,
    #[serde(default)]
    pub model_preferences: HashMap<String, HashMap<String, bool>>,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(skip)]
    pub config_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    // Settings can be added here in the future
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
}
