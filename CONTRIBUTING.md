# Contributing to MiniClue

Thanks for contributing.

## Contributor Docs

- Contributor docs index: `docs/contributors/README.md`
- Development commands: `docs/contributors/dev-commands.md`
- Architecture: `docs/contributors/architecture.md`
- Pipeline details: `docs/contributors/pipeline.md`
- Tauri IPC workflow: `docs/contributors/tauri-ipc.md`
- Database and migrations: `docs/contributors/database.md`

## Local Setup

```bash
bun install
bun run dev
```

## Required Checks Before PR

```bash
bun run check:all
```

If needed, run:

```bash
bun run fix
bun run rust:fmt
```

## Typical Development Flow

1. Create a branch from `main`.
2. Make your changes.
3. If Rust command/types changed, run `bun run gen:bindings`.
4. Run `bun run check:all`.
5. Open a pull request with a clear description.

## Backend-Specific Notes

- For schema changes, create a new migration in `src-tauri/migrations/`.
- Keep migrations additive and avoid editing released migration files.
- Prefer returning `Result<T, ApiError>` from commands.

## Frontend-Specific Notes

- Use TanStack Query for server state.
- Invalidate relevant query keys after mutations.
- Use wrappers in `src/lib/tauri.ts`; avoid direct `invoke` usage from components.

## AI-Assisted Contributions

Use `AGENTS.md` as the single source of guidance for AI-assisted development in this repository.
