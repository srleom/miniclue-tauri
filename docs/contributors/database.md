# Database and Migrations

MiniClue uses SQLite for local persistence and SQLx for schema migrations.

## Core Tables

| Table | Purpose |
| --- | --- |
| `documents` | PDF metadata and processing status |
| `pages` | Extracted page text and metadata |
| `chunks` | Retrieval chunks linked to pages |
| `embeddings` | Vector embeddings for chunks |
| `chats` | Chat sessions |
| `messages` | User and assistant messages |
| `folders` | Optional document organization |

## Migration Workflow

```bash
cd src-tauri && sqlx migrate add <descriptive_name>
```

Guidelines:

- Use `IF NOT EXISTS` where applicable.
- Keep migrations additive.
- Do not edit released migration files.
- Verify by running `bun run dev`.
