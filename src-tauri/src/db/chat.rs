use sqlx::SqlitePool;

use crate::models::chat::{Chat, Message};

pub async fn get_chats(
    pool: &SqlitePool,
    document_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<Chat>, sqlx::Error> {
    sqlx::query_as::<_, Chat>(
        "SELECT id, document_id, title, created_at, updated_at \
         FROM chats WHERE document_id = ? \
         ORDER BY updated_at DESC LIMIT ? OFFSET ?",
    )
    .bind(document_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_chat(
    pool: &SqlitePool,
    document_id: &str,
    chat_id: &str,
) -> Result<Chat, sqlx::Error> {
    sqlx::query_as::<_, Chat>(
        "SELECT id, document_id, title, created_at, updated_at \
         FROM chats WHERE id = ? AND document_id = ?",
    )
    .bind(chat_id)
    .bind(document_id)
    .fetch_one(pool)
    .await
}

pub async fn create_chat(
    pool: &SqlitePool,
    id: &str,
    document_id: &str,
    title: &str,
) -> Result<Chat, sqlx::Error> {
    sqlx::query_as::<_, Chat>(
        "INSERT INTO chats (id, document_id, title) VALUES (?, ?, ?) \
         RETURNING id, document_id, title, created_at, updated_at",
    )
    .bind(id)
    .bind(document_id)
    .bind(title)
    .fetch_one(pool)
    .await
}

pub async fn update_chat(
    pool: &SqlitePool,
    id: &str,
    document_id: &str,
    title: Option<&str>,
) -> Result<Chat, sqlx::Error> {
    let query = if title.is_some() {
        "UPDATE chats SET title = ?, updated_at = datetime('now') \
         WHERE id = ? AND document_id = ? \
         RETURNING id, document_id, title, created_at, updated_at"
    } else {
        "SELECT id, document_id, title, created_at, updated_at \
         FROM chats WHERE id = ? AND document_id = ?"
    };

    if let Some(t) = title {
        sqlx::query_as::<_, Chat>(query)
            .bind(t)
            .bind(id)
            .bind(document_id)
            .fetch_one(pool)
            .await
    } else {
        sqlx::query_as::<_, Chat>(query)
            .bind(id)
            .bind(document_id)
            .fetch_one(pool)
            .await
    }
}

pub async fn delete_chat(
    pool: &SqlitePool,
    id: &str,
    document_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM chats WHERE id = ? AND document_id = ?")
        .bind(id)
        .bind(document_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_messages(
    pool: &SqlitePool,
    chat_id: &str,
    limit: i64,
) -> Result<Vec<Message>, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        "SELECT id, chat_id, role, parts, metadata, created_at \
         FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT ?",
    )
    .bind(chat_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn count_messages(pool: &SqlitePool, chat_id: &str) -> Result<i64, sqlx::Error> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages WHERE chat_id = ?")
        .bind(chat_id)
        .fetch_one(pool)
        .await?;
    Ok(count.0)
}

#[allow(dead_code)]
pub async fn create_message(
    pool: &SqlitePool,
    id: &str,
    chat_id: &str,
    role: &str,
    parts: &str,
    metadata: &str,
) -> Result<Message, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        "INSERT INTO messages (id, chat_id, role, parts, metadata) VALUES (?, ?, ?, ?, ?) \
         RETURNING id, chat_id, role, parts, metadata, created_at",
    )
    .bind(id)
    .bind(chat_id)
    .bind(role)
    .bind(parts)
    .bind(metadata)
    .fetch_one(pool)
    .await
}
