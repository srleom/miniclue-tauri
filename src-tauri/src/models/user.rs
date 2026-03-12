use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UserFolder {
    pub id: String,
    pub title: String,
    pub description: String,
    pub is_default: bool,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documents: Option<Vec<UserFolderDocument>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UserFolderDocument {
    pub id: String,
    pub title: String,
    pub status: String,
    pub folder_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RecentDocument {
    pub document_id: String,
    pub folder_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RecentDocumentsResponse {
    pub documents: Vec<RecentDocument>,
    #[specta(type = i32)]
    pub total_count: i64,
}

// Model catalog types
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelToggle {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub vision: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProviderModels {
    pub provider: String,
    pub models: Vec<ModelToggle>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelsResponse {
    pub providers: Vec<ProviderModels>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ApiKeyResponse {
    pub provider: String,
    pub has_provided_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CustomProviderRequest {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CustomProviderResponse {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model_id: String,
}
