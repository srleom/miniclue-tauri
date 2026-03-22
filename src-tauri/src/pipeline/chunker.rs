use thiserror::Error;
use tokenizers::Tokenizer;

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

/// Conservative chunk size relative to nomic-embed-text-v1.5's 512 WordPiece token limit.
/// Using the same BERT WordPiece tokenizer ensures counts are exact — no approximation needed.
const MAX_CHUNK_TOKENS: usize = 450;
const OVERLAP_TOKENS: usize = 50;

/// Chunk text using a token-based sliding window with the nomic-embed-text BERT WordPiece
/// tokenizer. Because WordPiece boundaries always align with Unicode codepoints, decoding any
/// contiguous slice of token IDs produced by `encode` always yields valid UTF-8 — no retry
/// loop is needed.
///
/// - Max chunk size: 450 WordPiece tokens (ample headroom below the 512-token model limit)
/// - Overlap: 50 tokens
pub fn chunk_pages(
    pages: &[(i64, String)],
    tokenizer: &Tokenizer,
) -> Result<Vec<ChunkedPage>, ChunkerError> {
    let mut results = Vec::new();

    for (page_number, text) in pages {
        let chunks = chunk_text(text, tokenizer)?;
        results.push(ChunkedPage {
            page_number: *page_number,
            chunks,
        });
    }

    Ok(results)
}

fn chunk_text(text: &str, tokenizer: &Tokenizer) -> Result<Vec<TextChunk>, ChunkerError> {
    if text.trim().is_empty() {
        return Ok(vec![]);
    }

    let encoding = tokenizer
        .encode(text, false)
        .map_err(|e| ChunkerError::TokenizationError(e.to_string()))?;

    let token_ids = encoding.get_ids();

    if token_ids.is_empty() {
        return Ok(vec![]);
    }

    // If text fits in one chunk, skip the splitting loop entirely
    if token_ids.len() <= MAX_CHUNK_TOKENS {
        return Ok(vec![TextChunk {
            text: text.to_string(),
            token_count: token_ids.len() as i64,
            chunk_index: 0,
        }]);
    }

    let mut chunks = Vec::new();
    let mut start_idx = 0;
    let mut chunk_index = 0;

    while start_idx < token_ids.len() {
        let end_idx = (start_idx + MAX_CHUNK_TOKENS).min(token_ids.len());

        let chunk_text = tokenizer
            .decode(&token_ids[start_idx..end_idx], false)
            .map_err(|e| ChunkerError::TokenizationError(e.to_string()))?;

        chunks.push(TextChunk {
            text: chunk_text,
            token_count: (end_idx - start_idx) as i64,
            chunk_index,
        });

        chunk_index += 1;

        if end_idx >= token_ids.len() {
            break;
        }

        start_idx = end_idx.saturating_sub(OVERLAP_TOKENS);
    }

    Ok(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_tokenizer() -> Tokenizer {
        // Load the bundled tokenizer.json from the source tree (available after `cargo build`)
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("models")
            .join("tokenizer.json");
        Tokenizer::from_file(&path).expect("tokenizer.json must be present (run `cargo build`)")
    }

    #[test]
    fn test_chunk_empty_text() {
        let tokenizer = test_tokenizer();
        let pages = vec![(1, String::new())];
        let result = chunk_pages(&pages, &tokenizer).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].chunks.len(), 0);
    }

    #[test]
    fn test_chunk_short_text() {
        let tokenizer = test_tokenizer();
        let pages = vec![(1, "This is a short text.".to_string())];
        let result = chunk_pages(&pages, &tokenizer).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].chunks.len(), 1);
        assert_eq!(result[0].chunks[0].chunk_index, 0);
    }

    #[test]
    fn test_chunk_multibyte_unicode() {
        let tokenizer = test_tokenizer();
        // Chinese text — previously caused UTF-8 boundary errors with cl100k BPE
        let chinese = "中文文本测试，这是一个包含多字节Unicode字符的段落。".repeat(30);
        let pages = vec![(1, chinese)];
        let result = chunk_pages(&pages, &tokenizer).unwrap();
        assert!(result[0].chunks.len() >= 1);
        // All chunks must be valid UTF-8 strings
        for chunk in &result[0].chunks {
            assert!(std::str::from_utf8(chunk.text.as_bytes()).is_ok());
        }
    }
}
