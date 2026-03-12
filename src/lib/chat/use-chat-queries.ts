import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import {
  createChat,
  deleteChat,
  getChat,
  getChats,
  listMessages,
  streamChat,
  updateChat,
} from '@/lib/tauri';
import type {
  Chat,
  ChatCreate,
  ChatStreamEvent,
  ChatUpdate,
} from '@/lib/types';

/**
 * Query keys for chat data
 */
export const chatKeys = {
  all: ['chats'] as const,
  document: (documentId: string) => [...chatKeys.all, documentId] as const,
  chat: (documentId: string, chatId: string) =>
    [...chatKeys.document(documentId), chatId] as const,
  messages: (documentId: string, chatId: string) =>
    [...chatKeys.chat(documentId, chatId), 'messages'] as const,
};

/**
 * Hook to fetch all chats for a document
 */
export function useChats(documentId: string) {
  return useQuery({
    queryKey: chatKeys.document(documentId),
    queryFn: () => getChats(documentId),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a specific chat
 */
export function useChat(documentId: string, chatId: string) {
  return useQuery({
    queryKey: chatKeys.chat(documentId, chatId),
    queryFn: () => getChat(documentId, chatId),
    staleTime: 5 * 60 * 1000,
    enabled: !!chatId,
  });
}

/**
 * Hook to fetch messages for a chat
 * Returns messages in ThreadMessageLike format
 */
export function useChatMessages(documentId: string, chatId: string) {
  return useQuery({
    queryKey: chatKeys.messages(documentId, chatId),
    queryFn: async () => {
      const messages = await listMessages(documentId, chatId);
      // Convert Message[] to ThreadMessageLike[]
      return messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.parts.map((part) => ({
          type: 'text' as const,
          text: part.text || '',
        })),
        createdAt: new Date(msg.created_at),
        metadata: msg.metadata,
      }));
    },
    staleTime: 1000, // 1 second - refetch more aggressively for real-time chat
    enabled: !!chatId && !!documentId,
  });
}

/**
 * Hook to create a new chat
 */
export function useCreateChat(documentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ChatCreate) => createChat(documentId, data),
    onSuccess: (newChat) => {
      // Optimistically add the new chat to the cache
      queryClient.setQueryData<Chat[]>(
        chatKeys.document(documentId),
        (oldChats = []) => {
          // Add to the beginning of the list (most recent first)
          return [newChat, ...oldChats];
        }
      );

      // Initialize empty messages array for the new chat
      queryClient.setQueryData(chatKeys.messages(documentId, newChat.id), []);
    },
    onError: (error) => {
      // Revert optimistic update on error
      queryClient.invalidateQueries({
        queryKey: chatKeys.document(documentId),
      });
      console.error('Failed to create chat:', error);
    },
  });
}

/**
 * Hook to update a chat
 */
export function useUpdateChat(documentId: string, chatId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ChatUpdate) => updateChat(documentId, chatId, data),
    onSuccess: (updatedChat) => {
      // Update individual chat cache
      queryClient.setQueryData(chatKeys.chat(documentId, chatId), updatedChat);

      // Update in chats list
      queryClient.setQueryData<Chat[]>(
        chatKeys.document(documentId),
        (oldChats = []) =>
          oldChats.map((chat) => (chat.id === chatId ? updatedChat : chat))
      );
    },
  });
}

/**
 * Hook to delete a chat
 */
export function useDeleteChat(documentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chatId: string) => deleteChat(documentId, chatId),
    onSuccess: (_, chatId) => {
      // Optimistically remove from cache
      queryClient.setQueryData<Chat[]>(
        chatKeys.document(documentId),
        (oldChats = []) => oldChats.filter((chat) => chat.id !== chatId)
      );

      // Remove individual chat and messages caches
      queryClient.removeQueries({
        queryKey: chatKeys.chat(documentId, chatId),
      });
      queryClient.removeQueries({
        queryKey: chatKeys.messages(documentId, chatId),
      });
    },
  });
}

/**
 * Hook to send a message with streaming.
 *
 * `cancelledRef` is a mutable ref shared with the caller. When set to `true`
 * the event handler stops forwarding chunks and ignores the done/title events,
 * effectively cancelling the stream from the UI perspective. The underlying
 * Rust command continues until its HTTP stream ends, but its channel events
 * are silently dropped.
 */
export function useSendMessage(
  documentId: string,
  chatId: string,
  model: string,
  cancelledRef: React.MutableRefObject<boolean>
) {
  return useMutation({
    mutationFn: async ({
      message,
      citedPages,
      onChunk,
      onDone,
      onTitleUpdated,
    }: {
      message: string;
      citedPages?: number[];
      onChunk: (content: string) => void;
      onDone?: () => void;
      onTitleUpdated?: (payload: {
        chat_id: string;
        title: string;
        updated_at: string;
      }) => void;
    }) => {
      let accumulatedContent = '';

      await streamChat(
        documentId,
        chatId,
        message,
        model,
        (event) => {
          // Stop processing events if the user cancelled
          if (cancelledRef.current) return;

          if (event.event === 'chunk') {
            accumulatedContent += event.data.content;
            onChunk(accumulatedContent);
          } else if (event.event === 'done') {
            // Backend has saved the assistant message
            onDone?.();
          } else if (event.event === 'title_updated') {
            onTitleUpdated?.(event.data);
          } else if (event.event === 'error') {
            throw new Error(event.data.error);
          }
        },
        citedPages
      );

      return accumulatedContent;
    },
    // No onSuccess invalidation - we handle it in onDone callback
  });
}

/**
 * Type for streaming chat with custom event handler
 */
export type StreamChatOptions = {
  documentId: string;
  chatId: string;
  message: string;
  model: string;
  onEvent: (event: ChatStreamEvent) => void;
  citedPages?: number[];
};

/**
 * Direct streaming helper (not a hook)
 */
export async function streamChatWithEvents(
  options: StreamChatOptions
): Promise<void> {
  await streamChat(
    options.documentId,
    options.chatId,
    options.message,
    options.model,
    options.onEvent,
    options.citedPages
  );
}
