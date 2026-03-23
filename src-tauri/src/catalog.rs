use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct CloudModelEntry {
    pub provider: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub vision: bool,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct UnifiedCatalog {
    #[allow(dead_code)]
    schema_version: u32,
    #[allow(dead_code)]
    updated_at: String,
    #[serde(default)]
    cloud_models: Vec<CloudModelEntry>,
}

const BUNDLED_CATALOG: &str = include_str!("../resources/catalog.json");

fn load_unified_catalog() -> UnifiedCatalog {
    serde_json::from_str::<UnifiedCatalog>(BUNDLED_CATALOG).unwrap_or_else(|e| {
        panic!("Failed to parse bundled unified catalog: {e}");
    })
}

lazy_static::lazy_static! {
    static ref CATALOG: UnifiedCatalog = load_unified_catalog();
}

pub fn cloud_models_for_provider(provider: &str) -> Vec<CloudModelEntry> {
    CATALOG
        .cloud_models
        .iter()
        .filter(|m| m.provider == provider)
        .cloned()
        .collect()
}

pub fn cloud_default_models_for_provider(provider: &str) -> Vec<String> {
    CATALOG
        .cloud_models
        .iter()
        .filter(|m| m.provider == provider && m.is_default)
        .map(|m| m.id.clone())
        .collect()
}

pub fn cloud_model_supports_vision(model_id: &str) -> bool {
    CATALOG
        .cloud_models
        .iter()
        .find(|m| m.id == model_id)
        .map(|m| m.vision)
        .unwrap_or(false)
}

pub fn cloud_model_exists(provider: &str, model_id: &str) -> Option<CloudModelEntry> {
    CATALOG
        .cloud_models
        .iter()
        .find(|m| m.provider == provider && m.id == model_id)
        .cloned()
}
