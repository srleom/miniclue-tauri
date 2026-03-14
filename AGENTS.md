# MiniClue — Agent Guide

Tauri desktop app (Vite + React 19 frontend, Rust backend). Local-first: SQLite + sqlite-vec. LLM APIs: OpenAI / Anthropic / Gemini / xAI / DeepSeek / LlamaServer.

---

## Quick Commands

```bash
# Development
bun run dev            # Start Tauri app in dev mode (Vite + Rust hot reload)
bun run dev:fe         # Start Vite dev server only

# Build
bun run build          # Build production Tauri app for current platform
bun run build:fe       # Build frontend only (TypeScript check + Vite build)

# Frontend checks
bun run test:ts        # Type check TypeScript (no emit)
bun run lint           # Lint with Biome
bun run lint:fix       # Auto-fix lint
bun run format         # Format with Biome
bun run format:check   # Check formatting (no write)
bun run fix            # Auto-fix lint + format
bun run check          # type-check + format-check + lint

# Rust checks
bun run rust:fmt       # Format Rust code
bun run rust:lint      # Clippy
bun run rust:test      # Run Rust tests
bun run rust:check     # fmt-check + clippy + test

# Combined
bun run check:all      # All checks (frontend + Rust)
bun run fix && bun run rust:fmt  # Fix all auto-fixable issues
bun run gen:bindings   # Regenerate TypeScript bindings from Rust
```

---

## Implementation Flow

Always follow this order when adding a feature:

1. **DB change?** Run `cd src-tauri && sqlx migrate add <n>`. Write SQL with `IF NOT EXISTS`. Never modify a migration after release. Verify by running `bun run dev` — migrations apply on startup.

2. **New Tauri command?**
   - Define in `src-tauri/src/commands/*.rs` with `#[tauri::command]` and `#[specta::specta]`
   - Add `Type` derive to all request/response structs
   - Register in `src-tauri/src/main.rs` via `.invoke_handler()`
   - Register in `src-tauri/src/bindings.rs` for type generation
   - Run `bun run gen:bindings`
   - Wrap in `src/lib/tauri.ts` — never call `invoke` directly from components

3. **New mutation?** After writing it, grep the codebase for related `queryKey` usages and call `invalidateQueries` for every key the mutation affects, including inside `DownloadProvider`.

4. **Re-render check?** After any data change, think about what else on screen reflects that data. Look for components reading the same query keys, shared context, or local state derived from server data. If they won't automatically re-render, either invalidate their queries or update the shared source.

5. **Frontend data fetching?** Always TanStack Query. Never raw `useState` + `useEffect` for server state.

6. **Verify:** `bun run check:all` — fix all errors before finishing.

---

## Data Fetching: TanStack Query

```typescript
// Reading data
const { data, isPending, error } = useQuery({
  queryKey: ['llamaServerStatus'],
  queryFn: getLlamaServerStatus,
});

// After mutations: invalidate, don't manually set state
await setLocalChatEnabled(true, modelId);
await queryClient.invalidateQueries({ queryKey: ['models'] });

// Dynamic arrays of queries
useQueries({ queries: items.map(item => ({ queryKey: [...], queryFn: ... })) })

// Auto-polling
refetchInterval: (query) => query.state.data?.status === 'Starting' ? 2000 : false
```

---

## Tauri Commands & Specta

Commands live in `src-tauri/src/commands/*.rs`. All types must derive `Type` for Specta. Frontend always imports commands from `@/lib/tauri` and types from `@/lib/types` — never import from `bindings` directly.

### `src/lib/tauri.ts` wrapper pattern

Use the Specta-generated `commands` object, never raw `invoke`. Always pipe through the local `unwrap()` helper, which handles Specta's `{ status: 'ok' } | { status: 'error' }` discriminated union and throws a proper JS `Error`.

```typescript
// Standard query wrapper
export const getFolder = async (folderId: string): Promise<Folder> =>
  unwrap(await commands.getFolder(folderId));

// Optional args: use toNull() to convert undefined → null for Specta Option<T>
export const createFolder = async (data: FolderCreate): Promise<Folder> =>
  unwrap(await commands.createFolder({
    title: data.title,
    description: toNull(data.description),
  }));
```

For streaming commands, pass a `Channel<T>` — see **Chat Streaming** below. Channels are the one case where you interact with Tauri directly rather than through a typed wrapper.

### Specta type gotchas

| Rust type | Override |
|-----------|----------|
| `i64` | `#[specta(type = i32)]` |
| `serde_json::Value` | `#[specta(type = String)]` |

---

## Error Handling

Commands return `Result<T, ApiError>` — never `Result<T, String>`. `ApiError` is defined in `src-tauri/src/error.rs` with `code: String` and `message: String` fields.

The key conventions:
- Propagate errors with `?` throughout — `From` impls exist for `sqlx::Error`, `std::io::Error`, `String`, and `&str`
- Never panic; always return `Err(ApiError::...)`
- Use the named constructors (`ApiError::not_found(msg)`, `ApiError::invalid_input(msg)`, etc.) — don't construct `ApiError` directly
- On the frontend, `unwrap()` in `tauri.ts` extracts `.message` and throws it as a JS `Error`

Grep `src-tauri/src/error.rs` for the full list of constructors and their `code` values.

---

## AppState

Defined in `src-tauri/src/state.rs`. Access in commands via `state: State<'_, AppState>`.

| Field | Type | Purpose |
|-------|------|---------|
| `db` | `SqlitePool` | SQLite connection pool (sqlite-vec enabled) |
| `app_data_dir` | `PathBuf` | Runtime path to app data directory |
| `config` | `RwLock<AppConfig>` | API keys + settings; use `.read().await` / `.write().await` |
| `processing_semaphore` | `Arc<Semaphore>` | Caps concurrent PDF processing at 3 tasks |
| `llama_server` | `Arc<LlamaServerManager>` | Manages embedding + local chat sidecar processes |
| `model_manager` | `Arc<ModelManager>` | Model catalog and download management |

There is no per-provider LLM client in state. Read API keys from `config` at request time and make direct HTTP calls.

---

## Chat Streaming: Tauri Channels

```rust
#[tauri::command]
async fn stream_chat(
    state: State<'_, AppState>,
    chat_id: String,
    message: String,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), ApiError> {
    on_event.send(ChatStreamEvent::Chunk { content: "..." })?;
    Ok(())
}
```

```typescript
const channel = new Channel<ChatStreamEvent>();
channel.onmessage = (event) => {
  if (event.event === "chunk") appendToMessage(event.data.content);
};
// Channels are passed directly — no tauri.ts wrapper needed for streaming commands
await commands.streamChat({ chatId, message, onEvent: channel });
```

---

## Adding a New Route

File-based routing via `@tanstack/router-vite-plugin`. The generated `routeTree.gen.ts` updates automatically on save — never edit it manually.

**Naming conventions:**
- `_prefix` — pathless layout route (adds a layout wrapper, no URL segment)
- `$param` — dynamic segment (e.g. `$folderId` → `/folder/:folderId`)
- Files directly in `src/routes/` are outside the app shell

**File structure:**

```
src/routes/
  __root.tsx                      ← root layout; onboarding redirect guard lives here
  _app.tsx                        ← app shell layout (sidebar + SidebarInset + Outlet)
  _app/
    index.tsx                     ← "/"
    folder.$folderId.tsx          ← "/folder/:folderId"
    document.$documentId.tsx      ← "/document/:documentId"
  onboarding.tsx                  ← "/onboarding" (no app shell)
```

**Inside the app shell** — create `src/routes/_app/your-route.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/your-route')({
  component: YourRouteComponent,
});
```

**Outside the app shell** — create `src/routes/your-route.tsx` and use `createFileRoute('/your-route')`.

`queryClient` is injected into router context in `src/main.tsx` and accessible via `Route.useRouteContext()` or loader functions.

---

## File Storage

| Resource | Path |
|----------|------|
| App data root (macOS) | `~/Library/Application Support/miniclue/` |
| PDFs | `{app_data}/documents/{document_id}/original.pdf` |
| Config (API keys) | `{app_data}/config.json` |
| SQLite DB | `{app_data}/miniclue.db` |

Use `state.app_data_dir` in commands — don't call `tauri::path::app_data_dir()` directly.

---

## Database Migrations

Migrations in `src-tauri/migrations/`, applied automatically on startup via sqlx.

```bash
cd src-tauri && sqlx migrate add <n>
# Creates: migrations/{timestamp}_{name}.sql
```

- Always use `IF NOT EXISTS`
- Never modify a migration after release
- Test by running `bun run dev`