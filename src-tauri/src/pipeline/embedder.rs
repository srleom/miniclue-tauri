//! Embedder: calls the local llama-server embed endpoint.
//!
//! Uses the OpenAI-compatible `/v1/embeddings` API served by the bundled
//! `llama-server` sidecar (port 28881).
//!
//! Model: nomic-embed-text-v1.5 — 768-dimensional output.
//! Requires prefix `"search_document: "` on chunk text and
//!             `"search_query: "`    on query text.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;
use thiserror::Error;

use crate::services::llama_server::EMBED_PORT;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Error, Debug)]
pub enum EmbedderError {
    #[error("Embed server not available: {0}")]
    ServerUnavailable(String),
    #[error("API request failed: {0}")]
    ApiError(String),
    #[error("Network error: {0}")]
    NetworkError(String),
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct ChunkEmbedding {
    pub chunk_id: String,
    pub vector: Vec<f32>, // 768 dimensions (nomic-embed-text-v1.5)
    pub page_number: i64,
}

// ---------------------------------------------------------------------------
// OpenAI-compatible request / response structs
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    input: Vec<String>,
}

#[derive(Deserialize)]
struct EmbedResponse {
    data: Vec<EmbedData>,
}

#[derive(Deserialize)]
struct EmbedData {
    #[allow(dead_code)]
    index: usize,
    embedding: Vec<f32>,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES: u32 = 3;
const BATCH_SIZE: usize = 64; // nomic handles up to 8192 tokens; 64 chunks is safe

fn embed_url() -> String {
    format!("http://127.0.0.1:{EMBED_PORT}/v1/embeddings")
}

/// Shared HTTP client for all embed requests.
/// Reusing a single client avoids rebuilding the TLS stack and connection pool
/// on every query, which was a measurable source of per-request latency.
static EMBED_CLIENT: OnceLock<Client> = OnceLock::new();

fn embed_client() -> &'static Client {
    EMBED_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build embed HTTP client")
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Generate document embeddings for a batch of chunks.
///
/// `chunks` is a list of `(chunk_id, text, page_number)`.
/// Adds the `"search_document: "` prefix required by nomic-embed-text-v1.5.
pub async fn generate_embeddings(
    chunks: &[(String, String, i64)],
) -> Result<Vec<ChunkEmbedding>, EmbedderError> {
    if chunks.is_empty() {
        return Ok(Vec::new());
    }

    let client = embed_client();

    log::info!(
        "Generating local embeddings for {} chunks (batches of {BATCH_SIZE})",
        chunks.len()
    );

    let mut all_embeddings: Vec<ChunkEmbedding> = Vec::with_capacity(chunks.len());

    for batch in chunks.chunks(BATCH_SIZE) {
        let inputs: Vec<String> = batch
            .iter()
            .map(|(_, text, _)| format!("search_document: {text}"))
            .collect();

        let vectors = embed_batch(client, inputs).await?;

        if vectors.len() != batch.len() {
            return Err(EmbedderError::ApiError(format!(
                "Expected {} embeddings from server but got {}",
                batch.len(),
                vectors.len()
            )));
        }

        for ((chunk_id, _, page_number), vector) in batch.iter().zip(vectors.into_iter()) {
            all_embeddings.push(ChunkEmbedding {
                chunk_id: chunk_id.clone(),
                vector,
                page_number: *page_number,
            });
        }
    }

    log::info!("Successfully generated {} embeddings", all_embeddings.len());
    Ok(all_embeddings)
}

/// Generate a single query embedding.
///
/// Adds the `"search_query: "` prefix required by nomic-embed-text-v1.5.
/// Queries longer than 2000 characters are truncated with a warning — this is a
/// defensive guard against pathological inputs; typical search queries are well
/// under this limit.
pub async fn generate_query_embedding(query: &str) -> Result<Vec<f32>, EmbedderError> {
    const MAX_QUERY_CHARS: usize = 2000;
    let query = if query.len() > MAX_QUERY_CHARS {
        log::warn!(
            "Query truncated from {} to {MAX_QUERY_CHARS} characters before embedding",
            query.len()
        );
        &query[..MAX_QUERY_CHARS]
    } else {
        query
    };
    let client = embed_client();
    let input = format!("search_query: {query}");
    let mut vectors = embed_batch(client, vec![input]).await?;

    vectors
        .pop()
        .ok_or_else(|| EmbedderError::ApiError("Empty embedding response".to_string()))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn embed_batch(client: &Client, inputs: Vec<String>) -> Result<Vec<Vec<f32>>, EmbedderError> {
    let url = embed_url();
    let request_body = EmbedRequest {
        model: "nomic-embed-text-v1.5",
        input: inputs,
    };

    let mut retries = 0u32;
    loop {
        let response = client
            .post(&url)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    EmbedderError::ServerUnavailable(e.to_string())
                } else {
                    EmbedderError::NetworkError(e.to_string())
                }
            })?;

        let status = response.status();

        if status.is_success() {
            let embed_response: EmbedResponse = response
                .json()
                .await
                .map_err(|e| EmbedderError::ApiError(format!("JSON parse error: {e}")))?;

            // llama-server returns data sorted by index; preserve order
            let mut indexed: Vec<(usize, Vec<f32>)> = embed_response
                .data
                .into_iter()
                .map(|d| (d.index, d.embedding))
                .collect();
            indexed.sort_by_key(|(i, _)| *i);
            return Ok(indexed.into_iter().map(|(_, v)| v).collect());
        }

        if (status.as_u16() == 503 || status.as_u16() == 429) && retries < MAX_RETRIES {
            retries += 1;
            let delay_ms = 500 * 2u64.pow(retries - 1);
            log::warn!(
                "Embed server returned {status}, retry {retries}/{MAX_RETRIES} in {delay_ms}ms"
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
            continue;
        }

        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(EmbedderError::ApiError(format!("HTTP {status}: {body}")));
    }
}
