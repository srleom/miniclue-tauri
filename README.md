# MiniClue

Local-first desktop app for chatting with your PDF documents.

MiniClue runs as a Tauri app (React frontend + Rust backend). Documents, database, and configuration stay on your machine.

## Features

- Local-first storage (PDFs + SQLite database on device)
- Multi-provider AI support (OpenAI, Anthropic, Gemini, xAI, DeepSeek)
- RAG-style chat over imported PDFs
- Streaming chat responses
- Rust backend with SQLite + vector search support

## Quick Start

Prerequisites:

- Node.js 20+
- Bun 1.3+
- Rust toolchain ([rustup](https://rustup.rs/))

Run locally:

```bash
bun install
bun run dev
```

On first build, `src-tauri/build.rs` downloads required Pdfium binaries automatically.

## Documentation

- User docs index: `docs/users/README.md`
- Quick start: `docs/users/getting-started.md`
- Using MiniClue: `docs/users/using-miniclue.md`

## Contributing

- Contribution guide: `CONTRIBUTING.md`
- Contributor docs index: `docs/contributors/README.md`
- AI-assisted contribution guidance: `AGENTS.md`

## License

MIT. See `LICENSE.md`.
