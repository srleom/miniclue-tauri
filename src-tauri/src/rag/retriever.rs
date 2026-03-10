use crate::db;
use crate::pipeline::embedder;
use sqlx::SqlitePool;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum RetrieverError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
    #[error("Embedding error: {0}")]
    EmbeddingError(#[from] embedder::EmbedderError),
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct RetrievedChunk {
    pub chunk_id: String,
    pub text: String,
    pub page_number: i64,
    pub distance: f32,
}

/// Retrieve relevant chunks using vector similarity search
pub async fn retrieve_chunks(
    query: &str,
    document_id: &str,
    db: &SqlitePool,
    top_k: i64,
) -> Result<Vec<RetrievedChunk>, RetrieverError> {
    // Generate query embedding using local embed server
    let query_vector = embedder::generate_query_embedding(query).await?;

    // Retrieve similar chunks from database
    let results =
        db::embedding::retrieve_similar_chunks(db, document_id, &query_vector, top_k).await?;

    // Convert to RetrievedChunk format
    let chunks = results
        .into_iter()
        .map(|(chunk_id, text, page_number, distance)| RetrievedChunk {
            chunk_id,
            text,
            page_number,
            distance,
        })
        .collect();

    Ok(chunks)
}
