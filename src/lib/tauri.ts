import { Channel } from '@tauri-apps/api/core';
import type { ChatStreamEvent as GeneratedChatStreamEvent } from './bindings';
import { commands } from './bindings';
import type {
  ApiKeyResponse,
  Chat,
  ChatCreate,
  ChatStreamEvent,
  ChatUpdate,
  CustomProviderRequest,
  CustomProviderResponse,
  Document,
  DocumentUpdate,
  DownloadProgress,
  Folder,
  FolderCreate,
  FolderUpdate,
  HardwareProfile,
  ImportDocumentRequest,
  LlamaStatus,
  LocalModelStatus,
  Message,
  MessageResponse,
  ModelCatalog,
  ModelsResponse,
  ModelToggle,
  Provider,
  RecentDocumentsResponse,
  UserFolder,
} from './types';

// Helper to unwrap Result type from Tauri Specta bindings
function unwrap<T>(
  result: { status: 'ok'; data: T } | { status: 'error'; error: unknown }
): T {
  if (result.status === 'error') {
    const err = result.error;
    // Rust ApiError is a plain object { code, message } — convert to a real Error
    if (err !== null && typeof err === 'object' && 'message' in err) {
      throw new Error((err as { message: string }).message);
    }
    throw new Error(String(err));
  }
  return result.data;
}

// Helper to convert nullable fields from undefined to null
function toNull<T>(value: T | undefined | null): T | null {
  return value === undefined ? null : value;
}

// Helper to convert MessageResponse to Message (parse JSON strings)
function convertMessageResponse(msg: MessageResponse): Message {
  let parts: Message['parts'] = [];
  let metadata: Message['metadata'] = {};

  try {
    const parsedParts = JSON.parse(msg.parts);
    if (Array.isArray(parsedParts)) {
      parts = parsedParts as Message['parts'];
    }
  } catch (e) {
    console.error('Failed to parse message parts:', e);
  }

  try {
    const parsedMetadata = JSON.parse(msg.metadata);
    if (parsedMetadata && typeof parsedMetadata === 'object') {
      metadata = parsedMetadata as Message['metadata'];
    }
  } catch (e) {
    console.error('Failed to parse message metadata:', e);
  }

  return {
    id: msg.id,
    chat_id: msg.chat_id,
    role: msg.role as 'user' | 'assistant',
    parts,
    metadata,
    created_at: msg.created_at,
  };
}

// User commands
export const getFoldersWithDocuments = async (): Promise<UserFolder[]> => {
  return unwrap(await commands.getFoldersWithDocuments());
};

export const getRecentDocuments = async (
  limit?: number,
  offset?: number
): Promise<RecentDocumentsResponse> => {
  return unwrap(
    await commands.getRecentDocuments(limit ?? null, offset ?? null)
  );
};

// Folder commands
export const createFolder = async (data: FolderCreate): Promise<Folder> => {
  return unwrap(
    await commands.createFolder({
      title: data.title,
      description: toNull(data.description),
      is_default: toNull(data.is_default),
    })
  );
};

export const getFolder = async (folderId: string): Promise<Folder> => {
  return unwrap(await commands.getFolder(folderId));
};

export const updateFolder = async (
  folderId: string,
  data: FolderUpdate
): Promise<Folder> => {
  return unwrap(
    await commands.updateFolder(folderId, {
      title: toNull(data.title),
      description: toNull(data.description),
    })
  );
};

export const deleteFolder = async (folderId: string): Promise<void> => {
  unwrap(await commands.deleteFolder(folderId));
};

// Document commands
export const getDocuments = async (
  folderId: string,
  limit?: number,
  offset?: number
): Promise<Document[]> => {
  return unwrap(
    await commands.getDocuments(folderId, limit ?? null, offset ?? null)
  );
};

export const getDocument = async (documentId: string): Promise<Document> => {
  return unwrap(await commands.getDocument(documentId));
};

export const updateDocument = async (
  documentId: string,
  data: DocumentUpdate
): Promise<Document> => {
  return unwrap(
    await commands.updateDocument(documentId, {
      title: toNull(data.title),
      folder_id: toNull(data.folder_id),
      accessed_at: toNull(data.accessed_at),
    })
  );
};

export const deleteDocument = async (documentId: string): Promise<void> => {
  unwrap(await commands.deleteDocument(documentId));
};

export const getDocumentPdfPath = async (
  documentId: string
): Promise<string> => {
  return unwrap(await commands.getDocumentPdfPath(documentId));
};

export const getDocumentStatus = async (
  documentId: string
): Promise<{ status: string; error_details: string | null }> => {
  return unwrap(await commands.getDocumentStatus(documentId));
};

export const importDocuments = async (
  request: ImportDocumentRequest
): Promise<string[]> => {
  return unwrap(await commands.importDocuments(request));
};

// Chat commands
export const getChats = async (
  documentId: string,
  limit?: number,
  offset?: number
): Promise<Chat[]> => {
  return unwrap(
    await commands.getChats(documentId, limit ?? null, offset ?? null)
  );
};

export const getChat = async (
  documentId: string,
  chatId: string
): Promise<Chat> => {
  return unwrap(await commands.getChat(documentId, chatId));
};

export const createChat = async (
  documentId: string,
  data: ChatCreate
): Promise<Chat> => {
  return unwrap(
    await commands.createChat(documentId, {
      title: toNull(data.title),
    })
  );
};

export const updateChat = async (
  documentId: string,
  chatId: string,
  data: ChatUpdate
): Promise<Chat> => {
  return unwrap(
    await commands.updateChat(documentId, chatId, {
      title: toNull(data.title),
    })
  );
};

export const deleteChat = async (
  documentId: string,
  chatId: string
): Promise<void> => {
  unwrap(await commands.deleteChat(documentId, chatId));
};

export const listMessages = async (
  documentId: string,
  chatId: string,
  limit?: number
): Promise<Message[]> => {
  const responses = unwrap(
    await commands.listMessages(documentId, chatId, limit ?? null)
  );
  return responses.map(convertMessageResponse);
};

// Helper to convert generated ChatStreamEvent to frontend ChatStreamEvent
function convertChatStreamEvent(
  event: GeneratedChatStreamEvent
): ChatStreamEvent {
  if (event.event === 'UserMessageSaved') {
    return {
      event: 'user_message_saved',
      data: { message_id: event.message_id },
    };
  } else if (event.event === 'Chunk') {
    return { event: 'chunk', data: { content: event.content } };
  } else if (event.event === 'Done') {
    return { event: 'done', data: { message_id: event.message_id } };
  } else if (event.event === 'TitleUpdated') {
    return {
      event: 'title_updated',
      data: {
        chat_id: event.chat_id,
        title: event.title,
        updated_at: event.updated_at,
      },
    };
  } else if (event.event === 'Error') {
    return { event: 'error', data: { error: event.message } };
  }
  throw new Error('Unknown ChatStreamEvent variant');
}

// Stream chat with RAG
export const streamChat = async (
  documentId: string,
  chatId: string,
  message: string,
  model: string,
  onEvent: (event: ChatStreamEvent) => void,
  modelSupportsVision: boolean,
  citedPages?: number[]
): Promise<void> => {
  const channel = new Channel<GeneratedChatStreamEvent>();
  channel.onmessage = (generatedEvent) => {
    onEvent(convertChatStreamEvent(generatedEvent));
  };
  unwrap(
    await commands.streamChat(
      {
        document_id: documentId,
        chat_id: chatId,
        message,
        model,
        model_supports_vision: modelSupportsVision,
        cited_pages: citedPages ?? null,
      },
      channel
    )
  );
};

// Settings commands
export const storeApiKey = async (
  provider: string,
  apiKey: string
): Promise<ApiKeyResponse> => {
  return unwrap(await commands.storeApiKey(provider, apiKey));
};

export const deleteApiKey = async (
  provider: string
): Promise<ApiKeyResponse> => {
  return unwrap(await commands.deleteApiKey(provider));
};

export const listModels = async (): Promise<ModelsResponse> => {
  return unwrap(await commands.listModels());
};

export const updateModelPreference = async (
  provider: Provider,
  model: string,
  enabled: boolean
): Promise<ModelToggle> => {
  return unwrap(await commands.updateModelPreference(provider, model, enabled));
};

// Custom provider commands
export const listCustomProviders = async (): Promise<
  CustomProviderResponse[]
> => {
  return unwrap(await commands.listCustomProviders());
};

export const storeCustomProvider = async (
  request: CustomProviderRequest
): Promise<CustomProviderResponse> => {
  return unwrap(await commands.storeCustomProvider(request));
};

export const deleteCustomProvider = async (id: string): Promise<void> => {
  unwrap(await commands.deleteCustomProvider(id));
};

// Local AI commands
export const getHardwareProfile = async (): Promise<HardwareProfile> => {
  return unwrap(await commands.getHardwareProfile());
};

export const getModelCatalog = async (): Promise<ModelCatalog> => {
  return unwrap(await commands.getModelCatalog());
};

export const getRecommendedModelId = async (): Promise<string> => {
  return unwrap(await commands.getRecommendedModelId());
};

export const getLocalModelStatus = async (
  modelId: string
): Promise<LocalModelStatus> => {
  return unwrap(await commands.getLocalModelStatus(modelId));
};

export const downloadLocalModel = async (modelId: string): Promise<string> => {
  return unwrap(await commands.downloadLocalModel(modelId));
};

export const deleteLocalModel = async (modelId: string): Promise<void> => {
  unwrap(await commands.deleteLocalModel(modelId));
};

export const setLocalChatEnabled = async (
  enabled: boolean,
  modelId?: string | null
): Promise<void> => {
  unwrap(await commands.setLocalChatEnabled(enabled, modelId ?? null));
};

export const getLlamaServerStatus = async (): Promise<LlamaStatus> => {
  return unwrap(await commands.getLlamaServerStatus());
};

export type { DownloadProgress };
