# PDF Processing Pipeline

MiniClue processes PDFs locally through a staged pipeline.

## Workflow

```mermaid
sequenceDiagram
    participant User
    participant Frontend as React Frontend
    participant IPC as Tauri IPC
    participant Rust as Rust Backend
    participant DB as SQLite

    User->>Frontend: Import PDF
    Frontend->>IPC: call import command
    IPC->>Rust: Handle command

    Note over Rust: Background processing task
    Rust->>Rust: Parse PDF and extract text
    Rust->>Rust: Chunk text
    Rust->>Rust: Generate embeddings
    Rust->>DB: Save chunks and embeddings
    Rust->>DB: Update processing status

    Frontend->>IPC: Poll document status
    IPC->>Rust: Handle status query
    Rust->>DB: Read status
    DB->>Frontend: Return progress
```

## Stages

1. Parse PDF text and metadata
2. Chunk text for retrieval
3. Generate embeddings
4. Persist chunks and vectors
5. Mark status as complete/failed

## Concurrency

Concurrent processing is bounded with a semaphore to protect system responsiveness.
