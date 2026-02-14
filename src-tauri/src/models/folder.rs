use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Folder {
    pub id: String,
    pub title: String,
    pub description: String,
    pub is_default: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FolderResponse {
    pub id: String,
    pub title: String,
    pub description: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl From<Folder> for FolderResponse {
    fn from(f: Folder) -> Self {
        Self {
            id: f.id,
            title: f.title,
            description: f.description,
            is_default: f.is_default != 0,
            created_at: f.created_at,
            updated_at: f.updated_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct FolderCreate {
    pub title: String,
    pub description: Option<String>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct FolderUpdate {
    pub title: Option<String>,
    pub description: Option<String>,
}
