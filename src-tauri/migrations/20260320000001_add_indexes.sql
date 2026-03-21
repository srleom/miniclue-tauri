-- Add indexes for foreign keys and common query patterns
-- These indexes dramatically improve query performance for joins and lookups

-- Foreign key indexes for documents
CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id);

-- Foreign key indexes for pages
CREATE INDEX IF NOT EXISTS idx_pages_document_id ON pages(document_id);

-- Foreign key indexes for chunks
CREATE INDEX IF NOT EXISTS idx_chunks_page_id ON chunks(page_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

-- Composite index for chunks by document and page (used in RAG context building)
CREATE INDEX IF NOT EXISTS idx_chunks_document_page ON chunks(document_id, page_number);

-- Foreign key indexes for embeddings
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_document_id ON embeddings(document_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_page_id ON embeddings(page_id);

-- Foreign key indexes for chats
CREATE INDEX IF NOT EXISTS idx_chats_document_id ON chats(document_id);

-- Foreign key indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

-- Index for document status queries (used in UI to show pending/processing documents)
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

-- Index for document accessed_at (used for recent documents sorting)
CREATE INDEX IF NOT EXISTS idx_documents_accessed_at ON documents(accessed_at DESC);
