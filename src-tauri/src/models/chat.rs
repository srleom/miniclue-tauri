use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, Type)]
pub struct Chat {
    pub id: String,
    pub document_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct ChatCreate {
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct ChatUpdate {
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Message {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub parts: String,    // JSON string
    pub metadata: String, // JSON string
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MessageResponse {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub parts: String,    // Keep as JSON string
    pub metadata: String, // Keep as JSON string
    pub created_at: String,
}

impl From<Message> for MessageResponse {
    fn from(m: Message) -> Self {
        Self {
            id: m.id,
            chat_id: m.chat_id,
            role: m.role,
            parts: m.parts,       // Pass through as-is
            metadata: m.metadata, // Pass through as-is
            created_at: m.created_at,
        }
    }
}
