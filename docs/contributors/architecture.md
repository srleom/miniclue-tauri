# Architecture

MiniClue is a Tauri desktop app with React on the frontend and Rust on the backend.

## Project Layout

```text
miniclue-tauri/
|- src/                    # Frontend (Vite + React)
|  |- routes/              # TanStack Router routes
|  |- components/          # UI components
|  |- hooks/               # React hooks
|  `- lib/                 # Utilities and Tauri wrappers
|
`- src-tauri/              # Backend (Rust + Tauri)
   |- src/
   |  |- commands/         # Tauri command handlers
   |  |- services/         # Business logic and integrations
   |  |- db/               # SQLite repositories and queries
   |  |- models/           # Rust models
   |  |- pipeline/         # PDF processing pipeline
   |  `- config.rs         # App configuration
   `- migrations/          # SQLx migrations
```

## Data Flow

- Frontend uses typed wrappers in `src/lib/tauri.ts`.
- Wrappers call Specta-generated command bindings.
- Rust commands run business logic and persistence.
- TanStack Query manages frontend cache and refetch behavior.
