use sqlx::{Error as SqlxError, SqlitePool};
use std::cmp::Ordering;

/// Save pages to database
pub async fn save_pages(
    db: &SqlitePool,
    document_id: &str,
    pages: &[(i64, String, String)], // (page_number, raw_text, screenshot_path)
) -> Result<(), SqlxError> {
    for (page_number, raw_text, screenshot_path) in pages {
        let page_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO pages (id, document_id, page_number, raw_text, screenshot_path) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&page_id)
        .bind(document_id)
        .bind(page_number)
        .bind(raw_text)
        .bind(screenshot_path)
        .execute(db)
        .await?;
    }
    Ok(())
}

/// Save chunks to database
pub async fn save_chunks(
    db: &SqlitePool,
    document_id: &str,
    chunks: &[(String, i64, i64, String, i64)], // (page_id, page_number, chunk_index, text, token_count)
) -> Result<Vec<String>, SqlxError> {
    let mut chunk_ids = Vec::new();

    for (page_id, page_number, chunk_index, text, token_count) in chunks {
        let chunk_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO chunks (id, page_id, document_id, page_number, chunk_index, text, token_count)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&chunk_id)
        .bind(page_id)
        .bind(document_id)
        .bind(page_number)
        .bind(chunk_index)
        .bind(text)
        .bind(token_count)
        .execute(db)
        .await?;

        chunk_ids.push(chunk_id);
    }

    Ok(chunk_ids)
}

/// Save embeddings to database (both regular table and vec0 virtual table)
pub async fn save_embeddings(
    db: &SqlitePool,
    embeddings: &[(String, String, i64, Vec<f32>)], // (chunk_id, page_id, page_number, vector)
    model: &str,
) -> Result<(), SqlxError> {
    for (chunk_id, page_id, page_number, vector) in embeddings {
        // Convert vector to blob format for sqlite-vec
        let vector_blob: Vec<u8> = vector.iter().flat_map(|f| f.to_le_bytes()).collect();

        let metadata = serde_json::json!({
            "dimensions": vector.len(),
            "provider": "llama_server"
        })
        .to_string();

        // Save to regular embeddings table
        sqlx::query(
            "INSERT INTO embeddings (chunk_id, page_id, document_id, page_number, vector, metadata, embedding_model)
             SELECT ?, ?, document_id, ?, ?, ?, ? FROM chunks WHERE id = ?",
        )
        .bind(chunk_id)
        .bind(page_id)
        .bind(page_number)
        .bind(&vector_blob)
        .bind(&metadata)
        .bind(model)
        .bind(chunk_id)
        .execute(db)
        .await?;
    }

    Ok(())
}

/// Retrieve all chunks for specific page numbers of a document.
/// Returns (chunk_id, text, page_number) ordered by page_number, chunk_index.
pub async fn get_chunks_for_pages(
    db: &SqlitePool,
    document_id: &str,
    page_numbers: &[i32],
) -> Result<Vec<(String, String, i64)>, SqlxError> {
    if page_numbers.is_empty() {
        return Ok(Vec::new());
    }

    // Build a dynamic IN clause
    let placeholders = page_numbers
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");

    let query_str = format!(
        "SELECT id, text, page_number FROM chunks \
         WHERE document_id = ? AND page_number IN ({}) \
         ORDER BY page_number, chunk_index",
        placeholders
    );

    let mut query = sqlx::query_as::<_, (String, String, i64)>(&query_str).bind(document_id);
    for &pn in page_numbers {
        query = query.bind(pn);
    }

    query.fetch_all(db).await
}

/// Retrieve screenshot paths for specific page numbers of a document.
/// Returns `(page_number, screenshot_path)` pairs where `screenshot_path` is non-null,
/// ordered by page_number.
pub async fn get_screenshot_paths_for_pages(
    db: &SqlitePool,
    document_id: &str,
    page_numbers: &[i32],
) -> Result<Vec<(i64, String)>, SqlxError> {
    if page_numbers.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = page_numbers
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");

    let query_str = format!(
        "SELECT page_number, screenshot_path FROM pages \
         WHERE document_id = ? AND page_number IN ({}) AND screenshot_path IS NOT NULL \
         ORDER BY page_number",
        placeholders
    );

    let mut query = sqlx::query_as::<_, (i64, String)>(&query_str).bind(document_id);
    for &pn in page_numbers {
        query = query.bind(pn);
    }

    query.fetch_all(db).await
}

pub async fn retrieve_similar_chunks(
    db: &SqlitePool,
    document_id: &str,
    query_vector: &[f32],
    limit: i64,
) -> Result<Vec<(String, String, i64, f32)>, SqlxError> {
    if query_vector.is_empty() || limit <= 0 {
        return Ok(Vec::new());
    }

    // Fetch all candidate vectors for the document and rank in Rust.
    // This keeps retrieval correct even before sqlite-vec is fully wired.
    let rows = sqlx::query_as::<_, (String, String, i64, Vec<u8>)>(
        "SELECT c.id, c.text, c.page_number, e.vector
         FROM chunks c
         INNER JOIN embeddings e ON e.chunk_id = c.id
         WHERE c.document_id = ?",
    )
    .bind(document_id)
    .fetch_all(db)
    .await?;

    let mut scored: Vec<(String, String, i64, f32)> = rows
        .into_iter()
        .filter_map(|(chunk_id, text, page_number, vector_blob)| {
            cosine_similarity(query_vector, &vector_blob)
                .map(|score| (chunk_id, text, page_number, score))
        })
        .collect();

    scored.sort_by(|a, b| {
        b.3.partial_cmp(&a.3)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.2.cmp(&b.2))
    });
    scored.truncate(limit as usize);

    Ok(scored
        .into_iter()
        .map(|(chunk_id, text, page_number, score)| (chunk_id, text, page_number, 1.0 - score))
        .collect())
}

fn cosine_similarity(query: &[f32], vector_blob: &[u8]) -> Option<f32> {
    if vector_blob.len() != query.len() * 4 {
        return None;
    }

    let mut dot = 0.0_f32;
    let mut query_norm_sq = 0.0_f32;
    let mut candidate_norm_sq = 0.0_f32;

    for (i, bytes) in vector_blob.chunks_exact(4).enumerate() {
        let candidate = f32::from_le_bytes(
            bytes
                .try_into()
                .expect("chunks_exact(4) guarantees 4 bytes"),
        );
        let query_value = query[i];

        dot += query_value * candidate;
        query_norm_sq += query_value * query_value;
        candidate_norm_sq += candidate * candidate;
    }

    if query_norm_sq == 0.0 || candidate_norm_sq == 0.0 {
        return None;
    }

    Some(dot / (query_norm_sq.sqrt() * candidate_norm_sq.sqrt()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_blob(vector: &[f32]) -> Vec<u8> {
        vector.iter().flat_map(|f| f.to_le_bytes()).collect()
    }

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    async fn insert_embedding_fixture(pool: &SqlitePool) {
        sqlx::query("INSERT INTO folders (id, title, description, is_default) VALUES ('f1', 'Drafts', '', 1)")
            .execute(pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO documents (id, folder_id, title, file_path, status)
             VALUES ('doc1', 'f1', 'Doc', '/tmp/doc.pdf', 'complete')",
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pages (id, document_id, page_number, raw_text) VALUES
             ('p1', 'doc1', 1, 'alpha'),
             ('p2', 'doc1', 2, 'beta'),
             ('p3', 'doc1', 3, 'gamma')",
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO chunks (id, page_id, document_id, page_number, chunk_index, text, token_count) VALUES
             ('c1', 'p1', 'doc1', 1, 0, 'alpha chunk', 2),
             ('c2', 'p2', 'doc1', 2, 0, 'beta chunk', 2),
             ('c3', 'p3', 'doc1', 3, 0, 'gamma chunk', 2)",
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO embeddings (chunk_id, page_id, document_id, page_number, vector, metadata) VALUES
             (?, 'p1', 'doc1', 1, ?, '{}'),
             (?, 'p2', 'doc1', 2, ?, '{}'),
             (?, 'p3', 'doc1', 3, ?, '{}')",
        )
        .bind("c1")
        .bind(to_blob(&[1.0, 0.0]))
        .bind("c2")
        .bind(to_blob(&[0.0, 1.0]))
        .bind("c3")
        .bind(to_blob(&[-1.0, 0.0]))
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_retrieve_similar_chunks_orders_by_cosine_similarity() {
        let pool = setup_test_db().await;
        insert_embedding_fixture(&pool).await;

        let results = retrieve_similar_chunks(&pool, "doc1", &[1.0, 0.0], 2)
            .await
            .unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, "c1");
        assert_eq!(results[1].0, "c2");
        assert_eq!(results[0].2, 1);
        assert_eq!(results[1].2, 2);
    }

    #[tokio::test]
    async fn test_retrieve_similar_chunks_ignores_invalid_vector_blobs() {
        let pool = setup_test_db().await;
        insert_embedding_fixture(&pool).await;

        sqlx::query("UPDATE embeddings SET vector = X'010203' WHERE chunk_id = 'c2'")
            .execute(&pool)
            .await
            .unwrap();

        let results = retrieve_similar_chunks(&pool, "doc1", &[1.0, 0.0], 5)
            .await
            .unwrap();

        let returned_ids: Vec<&str> = results.iter().map(|(id, _, _, _)| id.as_str()).collect();
        assert!(returned_ids.contains(&"c1"));
        assert!(returned_ids.contains(&"c3"));
        assert!(!returned_ids.contains(&"c2"));
    }

    #[test]
    fn test_cosine_similarity_rejects_dimension_mismatch() {
        let similarity = cosine_similarity(&[1.0, 0.0], &to_blob(&[1.0, 0.0, 0.0]));
        assert!(similarity.is_none());
    }
}
