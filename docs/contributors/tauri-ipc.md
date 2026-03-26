# Tauri IPC and Type Safety

MiniClue uses Tauri commands with Specta-generated TypeScript bindings.

## Command Groups

### Document Commands

| Command | Parameters | Description |
| --- | --- | --- |
| `import_document` | `path: string, folderId?: string` | Import a PDF and start processing |
| `get_document` | `id: string` | Get document details and status |
| `get_documents` | `folderId?: string` | List documents |
| `delete_document` | `id: string` | Delete a document |
| `update_document` | `id: string, ...` | Update document metadata |

### Chat Commands

| Command | Parameters | Description |
| --- | --- | --- |
| `create_chat` | `documentId: string, name?: string` | Create a chat session |
| `stream_chat` | `chatId: string, message: string, onEvent` | Stream chat response |
| `get_chat_messages` | `chatId: string` | Get chat history |
| `get_chats` | `documentId?: string` | List chats |
| `delete_chat` | `chatId: string` | Delete a chat |

### Folder Commands

| Command | Parameters | Description |
| --- | --- | --- |
| `create_folder` | `name: string, parentId?: string` | Create folder |
| `get_folders` | `parentId?: string` | List folders |
| `update_folder` | `id: string, name: string` | Rename folder |
| `delete_folder` | `id: string` | Delete folder |

### Config Commands

| Command | Parameters | Description |
| --- | --- | --- |
| `get_config` | none | Read user config |
| `set_api_key` | `provider: string, key: string` | Store provider key |
| `set_model_preference` | `provider: string, model: string` | Set model preference |

## New Command Workflow

1. Define command in `src-tauri/src/commands/*.rs` with `#[tauri::command]` and `#[specta::specta]`.
2. Derive `Type` for request/response types.
3. Register in `src-tauri/src/main.rs`.
4. Register in `src-tauri/src/bindings.rs`.
5. Run `bun run gen:bindings`.
6. Add wrapper in `src/lib/tauri.ts`.

## Wrapper Pattern

```typescript
export const getFolder = async (folderId: string): Promise<Folder> =>
  unwrap(await commands.getFolder(folderId));
```

Use wrappers from components; avoid direct `invoke` in UI code.

## Streaming Pattern

```typescript
const channel = new Channel<ChatStreamEvent>();
channel.onmessage = (event) => {
  if (event.event === 'chunk') {
    appendToMessage(event.data.content);
  }
};
await commands.streamChat({ chatId, message, onEvent: channel });
```
