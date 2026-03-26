# Getting Started

## What You Need

- Node.js 20+
- Bun 1.3+
- Rust toolchain (install with [rustup](https://rustup.rs/))

## Run MiniClue Locally

```bash
bun install
bun run dev
```

This starts MiniClue in development mode with hot reload.

## Build a Production App

```bash
bun run build
```

On first build, required Pdfium binaries are downloaded automatically by `src-tauri/build.rs`.
