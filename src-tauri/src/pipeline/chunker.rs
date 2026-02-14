use thiserror::Error;
use tiktoken_rs::cl100k_base;

#[derive(Error, Debug)]
pub enum ChunkerError {
    #[error("Tokenization error: {0}")]
    TokenizationError(String),
}

#[derive(Debug, Clone)]
pub struct TextChunk {
    pub text: String,
    pub token_count: i64,
    pub chunk_index: i64,
}

#[derive(Debug)]
pub struct ChunkedPage {
    pub page_number: i64,
    pub chunks: Vec<TextChunk>,
}

const MAX_CHUNK_TOKENS: usize = 1000;
const OVERLAP_TOKENS: usize = 200;

/// Chunk text using token-based sliding window
/// - Max chunk size: 1000 tokens
/// - Overlap: 200 tokens
pub fn chunk_pages(pages: &[(i64, String)]) -> Result<Vec<ChunkedPage>, ChunkerError> {
    let bpe = cl100k_base().map_err(|e| ChunkerError::TokenizationError(e.to_string()))?;

    let mut results = Vec::new();

    for (page_number, text) in pages {
        let chunks = chunk_text(text, &bpe)?;
        results.push(ChunkedPage {
            page_number: *page_number,
            chunks,
        });
    }

    Ok(results)
}

fn chunk_text(text: &str, bpe: &tiktoken_rs::CoreBPE) -> Result<Vec<TextChunk>, ChunkerError> {
    if text.trim().is_empty() {
        return Ok(vec![]);
    }

    // Tokenize the entire text
    let tokens = bpe
        .encode_with_special_tokens(text)
        .into_iter()
        .collect::<Vec<_>>();

    if tokens.is_empty() {
        return Ok(vec![]);
    }

    // If text is small enough, return as single chunk
    if tokens.len() <= MAX_CHUNK_TOKENS {
        return Ok(vec![TextChunk {
            text: text.to_string(),
            token_count: tokens.len() as i64,
            chunk_index: 0,
        }]);
    }

    // Split into overlapping chunks
    let mut chunks = Vec::new();
    let mut start_idx = 0;
    let mut chunk_index = 0;

    while start_idx < tokens.len() {
        let end_idx = (start_idx + MAX_CHUNK_TOKENS).min(tokens.len());
        let chunk_tokens = &tokens[start_idx..end_idx];

        // Decode tokens back to text
        let chunk_text = bpe
            .decode(chunk_tokens.to_vec())
            .map_err(|e| ChunkerError::TokenizationError(e.to_string()))?;

        chunks.push(TextChunk {
            text: chunk_text,
            token_count: chunk_tokens.len() as i64,
            chunk_index,
        });

        chunk_index += 1;

        // Move window forward, accounting for overlap
        if end_idx >= tokens.len() {
            break;
        }
        start_idx += MAX_CHUNK_TOKENS - OVERLAP_TOKENS;
    }

    Ok(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_empty_text() {
        let pages = vec![(1, String::new())];
        let result = chunk_pages(&pages).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].chunks.len(), 0);
    }

    #[test]
    fn test_chunk_short_text() {
        let pages = vec![(1, "This is a short text.".to_string())];
        let result = chunk_pages(&pages).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].chunks.len(), 1);
        assert_eq!(result[0].chunks[0].chunk_index, 0);
    }
}
