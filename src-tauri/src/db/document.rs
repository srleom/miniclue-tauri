use sqlx::SqlitePool;

use crate::models::document::Document;

pub async fn get_documents_by_folder(
    pool: &SqlitePool,
    folder_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<Document>, sqlx::Error> {
    sqlx::query_as::<_, Document>(
        "SELECT id, folder_id, title, file_path, status, error_details, \
         total_pages, embeddings_complete, created_at, updated_at, accessed_at, completed_at \
         FROM documents WHERE folder_id = ? \
         ORDER BY created_at DESC LIMIT ? OFFSET ?",
    )
    .bind(folder_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_document(pool: &SqlitePool, id: &str) -> Result<Document, sqlx::Error> {
    sqlx::query_as::<_, Document>(
        "SELECT id, folder_id, title, file_path, status, error_details, \
         total_pages, embeddings_complete, created_at, updated_at, accessed_at, completed_at \
         FROM documents WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
}

pub async fn get_recent_documents(
    pool: &SqlitePool,
    limit: i64,
    offset: i64,
) -> Result<Vec<Document>, sqlx::Error> {
    sqlx::query_as::<_, Document>(
        "SELECT id, folder_id, title, file_path, status, error_details, \
         total_pages, embeddings_complete, created_at, updated_at, accessed_at, completed_at \
         FROM documents \
         ORDER BY accessed_at DESC LIMIT ? OFFSET ?",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn count_all_documents(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM documents")
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

pub async fn update_document(
    pool: &SqlitePool,
    id: &str,
    title: Option<&str>,
    folder_id: Option<&str>,
    accessed_at: Option<&str>,
) -> Result<Document, sqlx::Error> {
    let mut sets = vec!["updated_at = datetime('now')".to_string()];
    let mut binds: Vec<String> = Vec::new();

    if let Some(t) = title {
        binds.push(t.to_string());
        sets.push(format!("title = ?{}", binds.len()));
    }
    if let Some(f) = folder_id {
        binds.push(f.to_string());
        sets.push(format!("folder_id = ?{}", binds.len()));
    }
    if let Some(a) = accessed_at {
        binds.push(a.to_string());
        sets.push(format!("accessed_at = ?{}", binds.len()));
    }

    let id_pos = binds.len() + 1;

    let query = format!(
        "UPDATE documents SET {} WHERE id = ?{} \
         RETURNING id, folder_id, title, file_path, status, error_details, \
         total_pages, embeddings_complete, created_at, updated_at, accessed_at, completed_at",
        sets.join(", "),
        id_pos
    );

    let mut q = sqlx::query_as::<_, Document>(&query);
    for b in &binds {
        q = q.bind(b);
    }
    q = q.bind(id);

    q.fetch_one(pool).await
}

pub async fn get_document_ids_by_folder(
    pool: &SqlitePool,
    folder_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query_scalar("SELECT id FROM documents WHERE folder_id = ?")
        .bind(folder_id)
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn delete_document(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

#[allow(dead_code)]
pub async fn update_document_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    error_details: Option<&str>,
) -> Result<(), sqlx::Error> {
    if let Some(err) = error_details {
        sqlx::query(
            "UPDATE documents SET status = ?, error_details = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(status)
        .bind(err)
        .bind(id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query("UPDATE documents SET status = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(status)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

#[allow(dead_code)]
pub async fn create_document(
    pool: &SqlitePool,
    id: &str,
    folder_id: &str,
    title: &str,
    file_path: &str,
    status: &str,
) -> Result<Document, sqlx::Error> {
    sqlx::query_as::<_, Document>(
        "INSERT INTO documents (id, folder_id, title, file_path, status) \
         VALUES (?, ?, ?, ?, ?) \
         RETURNING id, folder_id, title, file_path, status, error_details, \
         total_pages, embeddings_complete, created_at, updated_at, accessed_at, completed_at",
    )
    .bind(id)
    .bind(folder_id)
    .bind(title)
    .bind(file_path)
    .bind(status)
    .fetch_one(pool)
    .await
}
