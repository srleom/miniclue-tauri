-- Migration: track embedding model per document/embedding
-- Nomic-embed-text-v1.5 produces 768-dim vectors (vs Gemini's 1536-dim).
-- We add an `embedding_model` column to `documents` and `embeddings` so we
-- can detect dimension mismatches on startup and re-queue affected documents.

ALTER TABLE documents ADD COLUMN embedding_model TEXT DEFAULT NULL;
ALTER TABLE embeddings ADD COLUMN embedding_model TEXT DEFAULT NULL;

-- Existing rows (Gemini embeddings) get tagged so they can be re-queued.
UPDATE documents    SET embedding_model = 'gemini-embedding-001' WHERE embeddings_complete = 1;
UPDATE embeddings   SET embedding_model = 'gemini-embedding-001';
