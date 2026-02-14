use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum EmbedderError {
    #[error("API request failed: {0}")]
    ApiError(String),
    #[error("Invalid API key")]
    InvalidApiKey,
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    #[error("Network error: {0}")]
    NetworkError(String),
}

#[derive(Debug, Clone)]
pub struct ChunkEmbedding {
    pub chunk_id: String,
    pub vector: Vec<f32>, // 1536 dimensions for gemini-embedding-001 (backward compatible)
    pub page_number: i64,
}

#[derive(Serialize)]
struct EmbedRequest {
    model: String,
    content: EmbedContent,
    #[serde(rename = "taskType")]
    task_type: String,
    #[serde(
        rename = "outputDimensionality",
        skip_serializing_if = "Option::is_none"
    )]
    output_dimensionality: Option<i32>,
}

#[derive(Serialize)]
struct EmbedContent {
    parts: Vec<TextPart>,
}

#[derive(Serialize)]
struct TextPart {
    text: String,
}

#[derive(Deserialize)]
struct EmbedResponse {
    embedding: EmbeddingData,
}

#[derive(Deserialize)]
struct EmbeddingData {
    values: Vec<f32>,
}

// Batch API request/response types
#[derive(Serialize)]
struct BatchEmbedRequest {
    requests: Vec<EmbedRequest>,
}

#[derive(Deserialize)]
struct BatchEmbedResponse {
    embeddings: Vec<EmbeddingData>,
}

const GEMINI_EMBEDDING_API_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
const GEMINI_BATCH_EMBEDDING_API_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";
const MAX_RETRIES: u32 = 3;

/// Generate embeddings using Gemini Batch API
/// Sends all chunks in a single batch request for maximum efficiency
pub async fn generate_embeddings(
    chunks: &[(String, String, i64)], // (chunk_id, text, page_number)
    api_key: &str,
) -> Result<Vec<ChunkEmbedding>, EmbedderError> {
    if chunks.is_empty() {
        return Ok(Vec::new());
    }

    // Create client with longer timeout for batch requests
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| EmbedderError::NetworkError(e.to_string()))?;

    log::info!(
        "Generating embeddings for {} chunks in single batch request",
        chunks.len()
    );

    // Build batch request with all chunks
    let requests: Vec<EmbedRequest> = chunks
        .iter()
        .map(|(_, text, _)| EmbedRequest {
            model: "models/gemini-embedding-001".to_string(),
            content: EmbedContent {
                parts: vec![TextPart { text: text.clone() }],
            },
            task_type: "RETRIEVAL_DOCUMENT".to_string(),
            output_dimensionality: Some(1536),
        })
        .collect();

    let batch_request = BatchEmbedRequest { requests };

    // Make batch API call with retry logic
    let response = make_batch_request_with_retry(&client, &batch_request, api_key).await?;

    // Map responses back to chunks
    if response.embeddings.len() != chunks.len() {
        return Err(EmbedderError::ApiError(format!(
            "Expected {} embeddings but got {}",
            chunks.len(),
            response.embeddings.len()
        )));
    }

    let embeddings: Vec<ChunkEmbedding> = chunks
        .iter()
        .zip(response.embeddings.iter())
        .map(|((chunk_id, _, page_number), embedding)| ChunkEmbedding {
            chunk_id: chunk_id.clone(),
            vector: embedding.values.clone(),
            page_number: *page_number,
        })
        .collect();

    log::info!("Successfully generated {} embeddings", embeddings.len());

    Ok(embeddings)
}

/// Make batch embedding request with exponential backoff retry
async fn make_batch_request_with_retry(
    client: &Client,
    batch_request: &BatchEmbedRequest,
    api_key: &str,
) -> Result<BatchEmbedResponse, EmbedderError> {
    let mut retries = 0;

    loop {
        let response = client
            .post(GEMINI_BATCH_EMBEDDING_API_URL)
            .header("x-goog-api-key", api_key)
            .header("Content-Type", "application/json")
            .json(&batch_request)
            .send()
            .await
            .map_err(|e| EmbedderError::NetworkError(e.to_string()))?;

        let status = response.status();

        if status.is_success() {
            return response
                .json::<BatchEmbedResponse>()
                .await
                .map_err(|e| EmbedderError::ApiError(format!("JSON parse error: {}", e)));
        }

        // Handle errors
        if status == 401 || status == 403 {
            return Err(EmbedderError::InvalidApiKey);
        }

        if status == 429 {
            if retries < MAX_RETRIES {
                retries += 1;
                let delay = 2_u64.pow(retries) * 1000; // Exponential backoff
                log::warn!(
                    "Rate limited, retrying in {}ms (attempt {}/{})",
                    delay,
                    retries,
                    MAX_RETRIES
                );
                tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                continue;
            }
            return Err(EmbedderError::RateLimitExceeded);
        }

        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(EmbedderError::ApiError(format!(
            "HTTP {}: {}",
            status, error_text
        )));
    }
}

/// Generate a single query embedding (still uses single-item API for queries)
pub async fn generate_query_embedding(
    query: &str,
    api_key: &str,
) -> Result<Vec<f32>, EmbedderError> {
    // Create client with 30 second timeout
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| EmbedderError::NetworkError(e.to_string()))?;

    let mut retries = 0;

    loop {
        let request = EmbedRequest {
            model: "models/gemini-embedding-001".to_string(),
            content: EmbedContent {
                parts: vec![TextPart {
                    text: query.to_string(),
                }],
            },
            task_type: "RETRIEVAL_QUERY".to_string(),
            output_dimensionality: Some(1536),
        };

        let response = client
            .post(GEMINI_EMBEDDING_API_URL)
            .header("x-goog-api-key", api_key)
            .json(&request)
            .send()
            .await
            .map_err(|e| EmbedderError::NetworkError(e.to_string()))?;

        let status = response.status();

        if status.is_success() {
            let embed_response: EmbedResponse = response
                .json()
                .await
                .map_err(|e| EmbedderError::ApiError(e.to_string()))?;

            return Ok(embed_response.embedding.values);
        }

        // Handle errors
        if status == 401 || status == 403 {
            return Err(EmbedderError::InvalidApiKey);
        }

        if status == 429 {
            if retries < MAX_RETRIES {
                retries += 1;
                let delay = 2_u64.pow(retries) * 1000; // Exponential backoff
                tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                continue;
            }
            return Err(EmbedderError::RateLimitExceeded);
        }

        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(EmbedderError::ApiError(format!(
            "API error ({}): {}",
            status, error_text
        )));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_generate_query_embedding_invalid_key() {
        let result = generate_query_embedding("test query", "invalid_key").await;
        assert!(result.is_err());
    }
}
