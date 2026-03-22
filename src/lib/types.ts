// Re-export generated types from Tauri Specta bindings
export type {
  ApiError,
  ApiKeyResponse,
  Chat,
  CustomProviderRequest,
  CustomProviderResponse,
  DocumentResponse as Document,
  DownloadProgress,
  FolderResponse as Folder,
  GpuClass,
  HardwareProfile,
  ImportDocumentRequest,
  LlamaStatus,
  LocalModelStatus,
  MessageResponse,
  ModelCatalog,
  ModelEntry,
  ModelsResponse,
  ModelToggle,
  ProviderModels,
  RecentDocument,
  RecentDocumentsResponse,
  Result,
  StreamChatRequest,
  UserFolder,
  UserFolderDocument,
} from './bindings';

// Make nullable fields accept undefined for easier usage
export type FolderCreate = {
  title: string;
  description?: string | null;
  is_default?: boolean | null;
};

export type FolderUpdate = {
  title?: string | null;
  description?: string | null;
};

export type ChatCreate = {
  title?: string | null;
};

export type ChatUpdate = {
  title?: string | null;
};

export type DocumentUpdate = {
  title?: string | null;
  folder_id?: string | null;
  accessed_at?: string | null;
};

// Transform ChatStreamEvent to snake_case event names used by the frontend runtime.
export type ChatStreamEvent =
  | { event: 'user_message_saved'; data: { message_id: string } }
  | { event: 'chunk'; data: { content: string } }
  | { event: 'done'; data: { message_id: string } }
  | {
      event: 'title_updated';
      data: { chat_id: string; title: string; updated_at: string };
    }
  | { event: 'error'; data: { error: string } };

export type DocumentStatusChangedEvent = {
  document_id: string;
  status: DocumentStatus;
  error_details: string | null;
  updated_at: string;
};

// Frontend-only types (not generated from Rust)

// Provider type (used in frontend only)
export type Provider = 'openai' | 'gemini' | 'anthropic' | 'xai' | 'deepseek';

// Error code type (extracted from ApiError.code for frontend use)
export type ErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'DATABASE_ERROR'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR'
  | 'API_KEY_ERROR'
  | 'FILE_ERROR'
  | 'PROCESSING_ERROR';

// Document status type (extracted from DocumentResponse.status for frontend use)
export type DocumentStatus =
  | 'uploading'
  | 'pending_processing'
  | 'parsing'
  | 'processing'
  | 'complete'
  | 'failed';

// Message part types (frontend-only, for parsing MessageResponse.parts JSON)
export interface MessagePart {
  type: string;
  text?: string;
  data?: ReferencePart;
}

export interface ReferencePart {
  type: string;
  text?: string;
  reference?: Reference;
}

export interface Reference {
  id: string;
  type: string;
  metadata?: Record<string, unknown>;
}

// Full Message type with parsed parts (frontend-only, extends MessageResponse)
export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  metadata: Record<string, unknown>;
  created_at: string;
}
