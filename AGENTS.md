MiniClue is a Tauri desktop app that allows anyone to chat with their PDF documents:

- **src/**: Vite + React 19 frontend with TanStack Router
- **src-tauri/**: Rust backend with SQLite + Tauri IPC

Stack: Local-first (SQLite + sqlite-vec), LLM APIs (OpenAI/Anthropic/Gemini/xAI/DeepSeek).

## Quick Commands

```bash
# Development
pnpm dev            # Start Tauri app in dev mode (Vite + Rust hot reload)
pnpm dev:fe         # Start Vite dev server only (frontend only)

# Build
pnpm build          # Build production Tauri app for current platform
pnpm build:fe       # Build frontend only (TypeScript check + Vite build)
pnpm preview        # Preview production build locally

# Frontend Quality Checks
pnpm test:ts        # Type check TypeScript (no emit)
pnpm lint           # Lint frontend code with ESLint
pnpm lint:fix       # Auto-fix linting issues
pnpm format         # Format code with Prettier
pnpm format:check   # Check if code is formatted (no write)
pnpm fix            # Auto-fix lint + format (lint:fix && format)
pnpm check          # Run all checks: type-check + format-check + lint

# Rust (Backend) Quality Checks
pnpm rust:fmt       # Format Rust code
pnpm rust:lint      # Lint Rust code (clippy)
pnpm rust:test      # Run Rust tests
pnpm rust:check     # Run all Rust checks: fmt-check + clippy + test
```

### Common Workflows

```bash
# Before committing
pnpm check:all      # Run all quality checks (frontend + Rust)

# Quick development cycle
pnpm dev            # Start Tauri app in dev mode

# Fix all auto-fixable issues
pnpm fix && pnpm rust:fmt

# After adding/changing Tauri commands
pnpm gen:bindings   # Regenerate TypeScript bindings from Rust
```

## Critical Patterns

### ✅ Tauri IPC (Frontend ↔ Rust Backend)

This project uses **Tauri Specta** for automatic end-to-end type safety. For backend changes:

1. Define Rust command in `src-tauri/src/commands/*.rs` with `#[tauri::command]` and `#[specta::specta]` macros
2. Add `Type` derive to all request/response structs
3. Register command in `src-tauri/src/main.rs` via `.invoke_handler()`
4. Register command in `src-tauri/src/bindings.rs` for type generation
5. Run `pnpm gen:bindings` to update TypeScript types (see Common Workflows)
6. Frontend: import commands from `@/lib/tauri`, types from `@/lib/types` (never `bindings` directly)
7. Use TanStack Query hooks for data fetching/caching

**Specta type gotchas** (use `#[specta(type = ...)]` on fields):

- `i64` → `#[specta(type = i32)]` (TypeScript doesn't support BigInt by default)
- `serde_json::Value` → `#[specta(type = String)]`

### Chat Streaming: Tauri Channels

Use Tauri's `Channel` API for server-sent events (chat streaming).

```rust
#[tauri::command]
async fn stream_chat(
    state: State<'_, AppState>,
    chat_id: String,
    message: String,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    // Stream chunks via: on_event.send(ChatStreamEvent::Chunk { content })
}
```

```typescript
const channel = new Channel<ChatStreamEvent>();
channel.onmessage = (event) => {
  if (event.event === 'chunk') appendToMessage(event.data.content);
};
await invoke('stream_chat', { chatId, message, onEvent: channel });
```

### File Storage

- App data directory: `tauri::path::app_data_dir()` → `~/Library/Application Support/com.miniclue.app/` (macOS)
- PDFs: `{app_data}/documents/{document_id}/original.pdf`
- Config (API keys): `{app_data}/config.json`
- SQLite DB: `{app_data}/miniclue.db`

### Code Organization

- **Frontend (React)**: `src/{routes, components, hooks, lib}` - TanStack Router + Query, shadcn/ui
- **Backend (Rust)**: `src-tauri/src/{commands, services, db, models, pipeline, rag, config.rs}` - Tauri IPC handlers

### assistant-ui

This project uses assistant-ui for chat interfaces.

Documentation: https://www.assistant-ui.com/llms-full.txt

Key patterns:

- Use AssistantRuntimeProvider at the app root
- Thread component for full chat interface
- AssistantModal for floating chat widget
- useChatRuntime hook with AI SDK transport

### Legacy: apps/ Directory

The `apps/` directory contains the old web monorepo (ai/, backend/, web/) and is kept for reference. This is legacy code from before the migration to the Tauri desktop app. You can reference it if needed but do not use it for development.

## Architecture Notes

**Data Pipeline**: PDF processing runs in background Rust tasks: parse → chunk → embed → complete

**Processing Flow**: Synchronous function calls in Rust (no message queue) with status updates to SQLite

## Database Schema & Migrations

MiniClue uses **sqlx's migration system** for versioned schema evolution.

**Key Facts**: SQLite at `{app_data}/miniclue.db`, migrations run on app startup. No RLS—single local user. Uses `sqlite-vec` for vector search.

**Creating a Migration**:

1. `cd src-tauri && sqlx migrate add <name>` — creates `migrations/{timestamp}_{name}.sql`
2. Write SQL in the generated file
3. Backup DB, then test: `cargo build && pnpm dev` (migrations auto-apply)

**Notes**: Use `IF NOT EXISTS` for safety. Never modify existing migration files after release.

## Feature/Fix Implementation Flow (MANDATORY)

1. **Plan**: Use plan mode to identify implementation approach, edge cases, and verification strategy

2. **Implement with Tests** (write implementation and tests together):

   **If changing database schema:**
   - Create a new migration file using `sqlx migrate add <name>` from `src-tauri/`
   - Write SQL in the generated `migrations/{timestamp}_{name}.sql` file
   - Test migration by deleting local DB and running app
   - No RLS needed - single local user app

   **If changing backend (Rust):**
   - Update Command/Service/Repository code with implementation
   - Write corresponding tests in `src-tauri/src/` test modules
   - Restart Tauri dev server to reload commands
   - Run `pnpm gen:bindings` to regenerate TypeScript types from Rust

   **If changing frontend:**
   - Implement UI using TanStack Router + Query patterns
   - Use invoke wrappers from `src/lib/tauri.ts`
   - Define manual browser test scenarios for verification

3. **Verify Immediately** (run tests and fix if needed):
   - **Frontend**: `pnpm test:ts`
   - **Backend**: `pnpm rust:test`
   - **Manual**: Test in running Tauri app (`pnpm dev`)

4. **Format and Lint** (from project root):
   - **Frontend**: `pnpm check` (type-check + format-check + lint)
   - **Backend**: `pnpm rust:fmt && pnpm rust:lint`
   - Or run `pnpm check:all` to verify both frontend and backend
   - Fix all errors if any appear
   - Re-run until no errors remain

5. **Iterate**: If any step fails (tests, formatting, linting), fix and re-verify from that step

6. **Mark complete** only after all tests pass, code is formatted, and no linting errors remain
