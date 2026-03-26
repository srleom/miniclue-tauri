# Using MiniClue

## What MiniClue Does

MiniClue lets you import PDF files and chat with them using AI.

## Core Workflow

1. Import one or more PDFs.
2. Wait for processing to complete.
3. Open a chat tied to a document.
4. Ask questions and review streamed responses.

## AI Providers

MiniClue supports multiple providers, including OpenAI, Anthropic, Gemini, xAI, and DeepSeek.

Provider keys and preferences are configured inside the app.

## Local-First Behavior

- Your PDFs are copied into app-managed local storage.
- Metadata and chat history are stored in a local SQLite database.
- No hosted MiniClue backend is required.
