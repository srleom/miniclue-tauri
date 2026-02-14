import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/tauri';
import type {
  FolderCreate,
  FolderUpdate,
  DocumentUpdate,
  ChatCreate,
  ChatUpdate,
  Provider,
} from '../lib/types';

// Folder queries
export function useFoldersWithDocuments() {
  return useQuery({
    queryKey: ['folders'],
    queryFn: api.getFoldersWithDocuments,
  });
}

export function useRecentDocuments(limit?: number, offset?: number) {
  return useQuery({
    queryKey: ['recents', limit, offset],
    queryFn: () => api.getRecentDocuments(limit, offset),
  });
}

export function useFolder(folderId: string) {
  return useQuery({
    queryKey: ['folder', folderId],
    queryFn: () => api.getFolder(folderId),
    enabled: !!folderId,
  });
}

export function useDocuments(
  folderId: string,
  limit?: number,
  offset?: number
) {
  return useQuery({
    queryKey: ['folder', folderId, 'documents', limit, offset],
    queryFn: () => api.getDocuments(folderId, limit, offset),
    enabled: !!folderId,
  });
}

// Document queries
export function useDocument(documentId: string) {
  return useQuery({
    queryKey: ['document', documentId],
    queryFn: () => api.getDocument(documentId),
    enabled: !!documentId,
  });
}

export function useDocumentPdfPath(documentId: string) {
  return useQuery({
    queryKey: ['document', documentId, 'pdf'],
    queryFn: () => api.getDocumentPdfPath(documentId),
    enabled: !!documentId,
  });
}

export function useDocumentStatus(documentId: string) {
  return useQuery({
    queryKey: ['document', documentId, 'status'],
    queryFn: () => api.getDocumentStatus(documentId),
    enabled: !!documentId,
  });
}

// Chat queries
export function useChats(documentId: string, limit?: number, offset?: number) {
  return useQuery({
    queryKey: ['document', documentId, 'chats', limit, offset],
    queryFn: () => api.getChats(documentId, limit, offset),
    enabled: !!documentId,
  });
}

export function useChat(documentId: string, chatId: string) {
  return useQuery({
    queryKey: ['document', documentId, 'chat', chatId],
    queryFn: () => api.getChat(documentId, chatId),
    enabled: !!documentId && !!chatId,
  });
}

export function useMessages(
  documentId: string,
  chatId: string,
  limit?: number
) {
  return useQuery({
    queryKey: ['document', documentId, 'chat', chatId, 'messages', limit],
    queryFn: () => api.listMessages(documentId, chatId, limit),
    enabled: !!documentId && !!chatId,
  });
}

// Settings queries
export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: api.listModels,
  });
}

// Mutations
export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FolderCreate) => api.createFolder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
  });
}

export function useUpdateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      folderId,
      data,
    }: {
      folderId: string;
      data: FolderUpdate;
    }) => api.updateFolder(folderId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['folder', variables.folderId],
      });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => api.deleteFolder(folderId),
    onSuccess: (_, folderId) => {
      // Invalidate all folders (updates sidebar)
      queryClient.invalidateQueries({ queryKey: ['folders'] });

      // Remove the deleted folder's data from cache
      queryClient.removeQueries({ queryKey: ['folder', folderId] });

      // Remove the deleted folder's documents from cache
      queryClient.removeQueries({
        queryKey: ['folder', folderId, 'documents'],
      });

      // Invalidate recent documents (deleted folder's documents were in recents)
      queryClient.invalidateQueries({ queryKey: ['recents'] });
    },
  });
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      data,
    }: {
      documentId: string;
      data: DocumentUpdate;
    }) => api.updateDocument(documentId, data),
    onSuccess: async (updatedDocument, variables) => {
      // Refetch the specific document
      await queryClient.refetchQueries({
        queryKey: ['document', variables.documentId],
      });

      // Refetch all folders (updates sidebar)
      await queryClient.refetchQueries({ queryKey: ['folders'] });

      // Refetch recent documents
      await queryClient.refetchQueries({ queryKey: ['recents'] });

      // Always refetch the current folder's documents using folder_id from response
      // This ensures the folder table updates for both rename and move operations
      await queryClient.refetchQueries({
        queryKey: ['folder', updatedDocument.folder_id, 'documents'],
      });
    },
  });
}

export function useMoveDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      folderId,
    }: {
      documentId: string;
      folderId: string;
    }) => api.updateDocument(documentId, { folder_id: folderId }),
    onSuccess: async (updatedDocument, variables) => {
      // Refetch the specific document
      await queryClient.refetchQueries({
        queryKey: ['document', variables.documentId],
      });

      // Refetch all folders (updates sidebar with document counts)
      await queryClient.refetchQueries({ queryKey: ['folders'] });

      // Refetch recent documents
      await queryClient.refetchQueries({ queryKey: ['recents'] });

      // Invalidate all folder documents queries to ensure both old and new folders update
      // This handles the case where we don't know which folder the document came from
      await queryClient.invalidateQueries({
        queryKey: ['folder'],
        predicate: (query) => {
          // Only invalidate queries that have 'documents' in their key
          const key = query.queryKey;
          return key.length >= 3 && key[2] === 'documents';
        },
      });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.deleteDocument(documentId),
    onSuccess: () => {
      // Invalidate all folders (updates sidebar)
      queryClient.invalidateQueries({ queryKey: ['folders'] });

      // Invalidate recent documents
      queryClient.invalidateQueries({ queryKey: ['recents'] });

      // Invalidate all folder documents queries to ensure the document is removed from the table
      queryClient.invalidateQueries({
        queryKey: ['folder'],
        predicate: (query) => {
          // Only invalidate queries that have 'documents' in their key
          const key = query.queryKey;
          return key.length >= 3 && key[2] === 'documents';
        },
      });
    },
  });
}

export function useCreateChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      data,
    }: {
      documentId: string;
      data: ChatCreate;
    }) => api.createChat(documentId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['document', variables.documentId, 'chats'],
      });
    },
  });
}

export function useUpdateChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      chatId,
      data,
    }: {
      documentId: string;
      chatId: string;
      data: ChatUpdate;
    }) => api.updateChat(documentId, chatId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['document', variables.documentId, 'chat', variables.chatId],
      });
      queryClient.invalidateQueries({
        queryKey: ['document', variables.documentId, 'chats'],
      });
    },
  });
}

export function useDeleteChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      chatId,
    }: {
      documentId: string;
      chatId: string;
    }) => api.deleteChat(documentId, chatId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['document', variables.documentId, 'chats'],
      });
    },
  });
}

export function useStoreApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      apiKey,
    }: {
      provider: Provider;
      apiKey: string;
    }) => api.storeApiKey(provider, apiKey),
    onSuccess: async (_, variables) => {
      console.log(
        `[useStoreApiKey] Mutation succeeded for ${variables.provider}, refetching queries...`
      );
      // Refetch queries to get the latest data from the backend
      await queryClient.refetchQueries({ queryKey: ['models'] });
      console.log(
        `[useStoreApiKey] Queries refetched successfully for ${variables.provider}`
      );

      // Add a small delay to ensure React has re-rendered with the new data
      // before the dialog closes. This guarantees the UI updates are visible.
      await new Promise((resolve) => setTimeout(resolve, 150));
      console.log(
        `[useStoreApiKey] Delay completed, UI should be updated for ${variables.provider}`
      );
    },
    onError: (error, variables) => {
      console.error(
        `[useStoreApiKey] Mutation failed for ${variables.provider}:`,
        error
      );
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: Provider) => api.deleteApiKey(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
  });
}

export function useUpdateModelPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      model,
      enabled,
    }: {
      provider: Provider;
      model: string;
      enabled: boolean;
    }) => api.updateModelPreference(provider, model, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
  });
}
