use sqlx::SqlitePool;
use uuid::Uuid;

use crate::models::folder::Folder;

type FolderDocument = (String, String, String, String);
type FolderWithDocuments = (Folder, Vec<FolderDocument>);

#[derive(sqlx::FromRow)]
struct FolderDocumentRow {
    // Folder fields
    folder_id: String,
    folder_title: String,
    folder_description: String,
    folder_is_default: i32,
    folder_created_at: String,
    folder_updated_at: String,
    // Document fields (nullable since LEFT JOIN)
    doc_id: Option<String>,
    doc_title: Option<String>,
    doc_status: Option<String>,
    doc_folder_id: Option<String>,
}

/// Get all folders with their documents in a single query (avoids N+1).
/// Returns a Vec of (Folder, Vec<(doc_id, doc_title, doc_status, doc_folder_id)>).
pub async fn get_folders_with_documents(
    pool: &SqlitePool,
) -> Result<Vec<FolderWithDocuments>, sqlx::Error> {
    let rows = sqlx::query_as::<_, FolderDocumentRow>(
        "SELECT 
            f.id as folder_id, 
            f.title as folder_title, 
            f.description as folder_description,
            f.is_default as folder_is_default, 
            f.created_at as folder_created_at, 
            f.updated_at as folder_updated_at,
            d.id as doc_id, 
            d.title as doc_title, 
            d.status as doc_status, 
            d.folder_id as doc_folder_id
        FROM folders f
        LEFT JOIN documents d ON d.folder_id = f.id
        ORDER BY f.is_default DESC, f.updated_at DESC, d.created_at DESC",
    )
    .fetch_all(pool)
    .await?;

    // Group by folder
    let mut result: Vec<FolderWithDocuments> = Vec::new();
    let mut current_folder_id: Option<String> = None;

    for row in rows {
        // Check if we're on a new folder
        if current_folder_id.as_ref() != Some(&row.folder_id) {
            // Push new folder
            let folder = Folder {
                id: row.folder_id.clone(),
                title: row.folder_title.clone(),
                description: row.folder_description.clone(),
                is_default: row.folder_is_default,
                created_at: row.folder_created_at.clone(),
                updated_at: row.folder_updated_at.clone(),
            };
            result.push((folder, Vec::new()));
            current_folder_id = Some(row.folder_id.clone());
        }

        // Add document if present (LEFT JOIN might return NULL)
        if let (Some(doc_id), Some(doc_title), Some(doc_status), Some(doc_folder_id)) =
            (row.doc_id, row.doc_title, row.doc_status, row.doc_folder_id)
        {
            if let Some((_, docs)) = result.last_mut() {
                docs.push((doc_id, doc_title, doc_status, doc_folder_id));
            }
        }
    }

    Ok(result)
}

pub async fn create_folder(
    pool: &SqlitePool,
    id: &str,
    title: &str,
    description: &str,
    is_default: bool,
) -> Result<Folder, sqlx::Error> {
    sqlx::query_as::<_, Folder>(
        "INSERT INTO folders (id, title, description, is_default) \
         VALUES (?, ?, ?, ?) \
         RETURNING id, title, description, is_default, created_at, updated_at",
    )
    .bind(id)
    .bind(title)
    .bind(description)
    .bind(is_default as i32)
    .fetch_one(pool)
    .await
}

pub async fn get_folder(pool: &SqlitePool, id: &str) -> Result<Folder, sqlx::Error> {
    sqlx::query_as::<_, Folder>(
        "SELECT id, title, description, is_default, created_at, updated_at \
         FROM folders WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
}

#[cfg(test)]
pub async fn get_all_folders(pool: &SqlitePool) -> Result<Vec<Folder>, sqlx::Error> {
    sqlx::query_as::<_, Folder>(
        "SELECT id, title, description, is_default, created_at, updated_at \
         FROM folders ORDER BY is_default DESC, updated_at DESC",
    )
    .fetch_all(pool)
    .await
}

pub async fn update_folder(
    pool: &SqlitePool,
    id: &str,
    title: Option<&str>,
    description: Option<&str>,
) -> Result<Folder, sqlx::Error> {
    // Build dynamic update
    let mut sets = vec!["updated_at = datetime('now')".to_string()];
    if title.is_some() {
        sets.push("title = ?1".to_string());
    }
    if description.is_some() {
        sets.push("description = ?2".to_string());
    }

    let query = format!(
        "UPDATE folders SET {} WHERE id = ?3 AND is_default = 0 \
         RETURNING id, title, description, is_default, created_at, updated_at",
        sets.join(", ")
    );

    sqlx::query_as::<_, Folder>(&query)
        .bind(title.unwrap_or(""))
        .bind(description.unwrap_or(""))
        .bind(id)
        .fetch_one(pool)
        .await
}

pub async fn delete_folder(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM folders WHERE id = ? AND is_default = 0")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

#[allow(dead_code)]
pub async fn get_default_folder(pool: &SqlitePool) -> Result<Option<Folder>, sqlx::Error> {
    sqlx::query_as::<_, Folder>(
        "SELECT id, title, description, is_default, created_at, updated_at \
         FROM folders WHERE is_default = 1",
    )
    .fetch_optional(pool)
    .await
}

/// Ensures that a default folder exists in the database.
/// If one already exists, returns its ID.
/// If none exists, creates a new default folder called "Drafts" and returns its ID.
pub async fn ensure_default_folder(pool: &SqlitePool) -> Result<String, sqlx::Error> {
    // Check if default folder exists
    let existing = sqlx::query_scalar::<_, String>("SELECT id FROM folders WHERE is_default = 1")
        .fetch_optional(pool)
        .await?;

    if let Some(id) = existing {
        return Ok(id);
    }

    // Create default folder if it doesn't exist
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO folders (id, title, description, is_default) VALUES (?, ?, ?, 1)")
        .bind(&id)
        .bind("Drafts")
        .bind("Your default folder for new documents")
        .execute(pool)
        .await?;

    Ok(id)
}

/// Returns the ID of the default folder.
/// Returns an error if no default folder exists.
pub async fn get_default_folder_id(pool: &SqlitePool) -> Result<String, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT id FROM folders WHERE is_default = 1")
        .fetch_one(pool)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_ensure_default_folder_creates_when_missing() {
        let pool = setup_test_db().await;

        // Verify no default folder exists initially
        let existing = get_default_folder(&pool).await.unwrap();
        assert!(existing.is_none());

        // Call ensure_default_folder
        let folder_id = ensure_default_folder(&pool).await.unwrap();

        // Verify default folder was created
        let folder = get_folder(&pool, &folder_id).await.unwrap();
        assert_eq!(folder.title, "Drafts");
        assert_eq!(folder.description, "Your default folder for new documents");
        assert_eq!(folder.is_default, 1);
    }

    #[tokio::test]
    async fn test_ensure_default_folder_returns_existing() {
        let pool = setup_test_db().await;

        // Create default folder first time
        let first_id = ensure_default_folder(&pool).await.unwrap();

        // Call again - should return same ID
        let second_id = ensure_default_folder(&pool).await.unwrap();

        assert_eq!(first_id, second_id);

        // Verify only one default folder exists
        let all_folders = get_all_folders(&pool).await.unwrap();
        let default_count = all_folders.iter().filter(|f| f.is_default == 1).count();
        assert_eq!(default_count, 1);
    }

    #[tokio::test]
    async fn test_get_default_folder_id() {
        let pool = setup_test_db().await;

        // Should fail when no default exists
        let result = get_default_folder_id(&pool).await;
        assert!(result.is_err());

        // Create default folder
        let created_id = ensure_default_folder(&pool).await.unwrap();

        // Should return the ID
        let fetched_id = get_default_folder_id(&pool).await.unwrap();
        assert_eq!(created_id, fetched_id);
    }

    #[tokio::test]
    async fn test_delete_default_folder_prevented() {
        let pool = setup_test_db().await;

        // Create default folder
        let folder_id = ensure_default_folder(&pool).await.unwrap();

        // Try to delete it
        delete_folder(&pool, &folder_id).await.unwrap();

        // Verify it still exists (delete was prevented)
        let folder = get_folder(&pool, &folder_id).await.unwrap();
        assert_eq!(folder.is_default, 1);
    }

    #[tokio::test]
    async fn test_update_default_folder_prevented() {
        let pool = setup_test_db().await;

        // Create default folder
        let folder_id = ensure_default_folder(&pool).await.unwrap();

        // Try to rename it
        let result = update_folder(&pool, &folder_id, Some("New Name"), None).await;

        // Update should fail (no rows affected)
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_non_default_folder_can_be_updated_and_deleted() {
        let pool = setup_test_db().await;

        // Create a regular folder
        let regular_id = Uuid::new_v4().to_string();
        create_folder(&pool, &regular_id, "Regular", "Description", false)
            .await
            .unwrap();

        // Update should succeed
        let updated = update_folder(&pool, &regular_id, Some("Updated"), None)
            .await
            .unwrap();
        assert_eq!(updated.title, "Updated");

        // Delete should succeed
        delete_folder(&pool, &regular_id).await.unwrap();
        let result = get_folder(&pool, &regular_id).await;
        assert!(result.is_err());
    }
}
