use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Document {
    pub id: String,
    pub folder_id: String,
    pub title: String,
    pub file_path: Option<String>,
    pub status: String,
    pub error_details: Option<String>,
    pub total_pages: i32,
    pub embeddings_complete: i32,
    pub created_at: String,
    pub updated_at: String,
    pub accessed_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DocumentResponse {
    pub id: String,
    pub folder_id: String,
    pub title: String,
    pub file_path: Option<String>,
    pub status: String,
    pub error_details: Option<String>,
    pub total_pages: i32,
    pub embeddings_complete: bool,
    pub created_at: String,
    pub updated_at: String,
    pub accessed_at: String,
    pub completed_at: Option<String>,
}

impl From<Document> for DocumentResponse {
    fn from(d: Document) -> Self {
        Self {
            id: d.id,
            folder_id: d.folder_id,
            title: d.title,
            file_path: d.file_path,
            status: d.status,
            error_details: d.error_details,
            total_pages: d.total_pages,
            embeddings_complete: d.embeddings_complete != 0,
            created_at: d.created_at,
            updated_at: d.updated_at,
            accessed_at: d.accessed_at,
            completed_at: d.completed_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct DocumentUpdate {
    pub title: Option<String>,
    pub folder_id: Option<String>,
    pub accessed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DocumentStatus {
    pub status: String,
    pub error_details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DocumentStatusChangedEvent {
    pub document_id: String,
    pub status: String,
    pub error_details: Option<String>,
    pub updated_at: String,
}
