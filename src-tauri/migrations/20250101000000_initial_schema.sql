-- Initial database schema for MiniClue
-- This migration creates all core tables for document management, 
-- PDF processing, embeddings, and chat functionality

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_default
    ON folders(is_default) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_details TEXT,
    total_pages INTEGER DEFAULT 0,
    embeddings_complete INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    accessed_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    raw_text TEXT DEFAULT '',
    UNIQUE(document_id, page_number)
);

CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_count INTEGER DEFAULT 0,
    UNIQUE(page_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS embeddings (
    chunk_id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    vector BLOB NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Chat',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    parts TEXT NOT NULL DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
