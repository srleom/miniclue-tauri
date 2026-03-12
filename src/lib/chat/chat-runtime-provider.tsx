import {
  type AppendMessage,
  AssistantRuntimeProvider,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSlideNavigation } from '@/lib/slide-navigation-context';
import { getChat } from '@/lib/tauri';
import type { Chat } from '@/lib/types';
import { chatKeys, useChatMessages, useSendMessage } from './use-chat-queries';

interface ChatRuntimeProviderProps {
  documentId: string;
  chatId: string;
  model: string;
  children: ReactNode;
}

/**
 * Parse @-mention slide references from the user's message text.
 *
 * Supports:
 *   @currentSlide  → resolves to currentPage
 *   @N             → literal page number N
 *
 * Returns { cleanedText, citedPages } where cleanedText has the @-tokens
 * preserved verbatim (so the user sees what they typed in their bubble) but
 * citedPages is a deduplicated array of page numbers to force-include in RAG.
 */
function parseSlideMentions(
  text: string,
  currentPage: number
): { citedPages: number[] } {
  const cited = new Set<number>();

  // Match @currentSlide or @<number>
  const mentionRegex = /@(currentSlide|\d+)/g;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop pattern
  while ((match = mentionRegex.exec(text)) !== null) {
    const token = match[1];
    if (token === 'currentSlide') {
      cited.add(currentPage);
    } else {
      const pageNum = Number.parseInt(token, 10);
      if (!Number.isNaN(pageNum) && pageNum > 0) {
        cited.add(pageNum);
      }
    }
  }

  return { citedPages: Array.from(cited) };
}

/**
 * Provider that bridges Tauri chat IPC with assistant-ui's ExternalStoreRuntime
 *
 * This component:
 * - Fetches messages from Tauri backend via TanStack Query
 * - Handles streaming responses via Tauri's Channel API
 * - Manages optimistic updates during message sending
 * - Converts backend Message format to assistant-ui's ThreadMessageLike
 */
export function ChatRuntimeProvider({
  documentId,
  chatId,
  model,
  children,
}: ChatRuntimeProviderProps): ReactElement {
  const [isRunning, setIsRunning] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<
    ThreadMessageLike[]
  >([]);

  // Shared cancellation flag. Set to true in onCancel; checked in the stream
  // event handler to silently drop further chunks/done events.
  const cancelledRef = useRef(false);

  const queryClient = useQueryClient();
  const { currentPage } = useSlideNavigation();

  // Fetch messages from backend (already converted to ThreadMessageLike)
  const { data: backendMessages = [] } = useChatMessages(documentId, chatId);

  // Mutation for sending messages with streaming
  const sendMessageMutation = useSendMessage(
    documentId,
    chatId,
    model,
    cancelledRef
  );

  // Combine backend messages with optimistic updates
  const messages = useMemo(() => {
    return [...backendMessages, ...optimisticMessages];
  }, [backendMessages, optimisticMessages]);

  const applyTitleUpdate = useCallback(
    (payload: { chat_id: string; title: string; updated_at: string }) => {
      queryClient.setQueryData<Chat | undefined>(
        chatKeys.chat(documentId, payload.chat_id),
        (oldChat) =>
          oldChat
            ? {
                ...oldChat,
                title: payload.title,
                updated_at: payload.updated_at,
              }
            : oldChat
      );

      queryClient.setQueryData<Chat[]>(
        chatKeys.document(documentId),
        (oldChats = []) =>
          oldChats.map((chat) =>
            chat.id === payload.chat_id
              ? {
                  ...chat,
                  title: payload.title,
                  updated_at: payload.updated_at,
                }
              : chat
          )
      );

      // Fallback refetch in case the cache did not have the target chat yet.
      queryClient.invalidateQueries({
        queryKey: chatKeys.chat(documentId, payload.chat_id),
      });
      queryClient.invalidateQueries({
        queryKey: chatKeys.document(documentId),
      });
    },
    [documentId, queryClient]
  );

  const refreshGeneratedTitle = useCallback(async () => {
    const cachedChat = queryClient.getQueryData<Chat>(
      chatKeys.chat(documentId, chatId)
    );

    // Avoid extra polling once the title has already been generated.
    if (cachedChat?.title && cachedChat.title !== 'New Chat') {
      return;
    }

    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const latestChat = await getChat(documentId, chatId);
        queryClient.setQueryData(chatKeys.chat(documentId, chatId), latestChat);
        queryClient.setQueryData<Chat[]>(
          chatKeys.document(documentId),
          (oldChats = []) =>
            oldChats.map((chat) => (chat.id === chatId ? latestChat : chat))
        );

        if (latestChat.title !== 'New Chat') {
          return;
        }
      } catch (error) {
        console.error('Error polling for generated title:', error);
        break;
      }
    }

    queryClient.invalidateQueries({
      queryKey: chatKeys.chat(documentId, chatId),
    });
    queryClient.invalidateQueries({
      queryKey: chatKeys.document(documentId),
    });
  }, [chatId, documentId, queryClient]);

  /**
   * Handle new message from user
   * 1. Add optimistic user message
   * 2. Add empty assistant message for streaming
   * 3. Stream response and update assistant message
   * 4. Clear optimistic messages when 'done' event received (backend has saved)
   */
  const onNew = useCallback(
    async (message: AppendMessage) => {
      if (message.content[0]?.type !== 'text') {
        throw new Error('Only text messages are supported');
      }

      const input = message.content[0].text;

      // Parse @-mention slide references before sending
      const { citedPages } = parseSlideMentions(input, currentPage);

      // Reset cancellation flag for the new request.
      // If a prior stream was cancelled, also flush any stale optimistic messages
      // so the real persisted history (including any partial saved by the backend)
      // is fetched fresh before we push new optimistic entries.
      if (cancelledRef.current) {
        cancelledRef.current = false;
        setOptimisticMessages([]);
        queryClient.invalidateQueries({
          queryKey: chatKeys.messages(documentId, chatId),
        });
      } else {
        cancelledRef.current = false;
      }

      // Create optimistic user message
      const userMessage: ThreadMessageLike = {
        id: `temp-user-${Date.now()}`,
        role: 'user',
        content: [{ type: 'text', text: input }],
        createdAt: new Date(),
      };

      // Create placeholder assistant message for streaming
      const assistantId = `temp-assistant-${Date.now()}`;
      const assistantMessage: ThreadMessageLike = {
        id: assistantId,
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        createdAt: new Date(),
      };

      // Add both to optimistic messages
      setOptimisticMessages([userMessage, assistantMessage]);
      setIsRunning(true);

      try {
        // Stream the response with event handling
        await sendMessageMutation.mutateAsync({
          message: input,
          citedPages: citedPages.length > 0 ? citedPages : undefined,
          onChunk: (accumulatedContent) => {
            // Update the assistant message with accumulated content
            setOptimisticMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId
                  ? {
                      ...msg,
                      content: [{ type: 'text', text: accumulatedContent }],
                    }
                  : msg
              )
            );
          },
          onDone: () => {
            // Clear optimistic messages FIRST to prevent duplicate display.
            // The query invalidation below triggers an async refetch; if we
            // cleared after invalidation, backendMessages could briefly contain
            // the real messages while optimisticMessages still held the temp ones.
            setOptimisticMessages([]);
            // Backend has saved both messages - refetch to show real messages
            queryClient.invalidateQueries({
              queryKey: chatKeys.messages(documentId, chatId),
            });
            // Invalidate chat data; title generation runs asynchronously after first exchange.
            queryClient.invalidateQueries({
              queryKey: chatKeys.chat(documentId, chatId),
            });
            // Invalidate chats list to update title in sidebar/dropdown
            queryClient.invalidateQueries({
              queryKey: chatKeys.document(documentId),
            });
            // Fallback polling to catch delayed async title generation.
            void refreshGeneratedTitle();
          },
          onTitleUpdated: (payload) => {
            applyTitleUpdate(payload);
          },
        });
      } catch (error) {
        console.error('Error sending message:', error);
        // Keep optimistic messages visible so user can see what failed
        // You might want to add error handling UI here
      } finally {
        setIsRunning(false);
      }
    },
    [
      sendMessageMutation,
      queryClient,
      documentId,
      chatId,
      currentPage,
      refreshGeneratedTitle,
      applyTitleUpdate,
    ]
  );

  /**
   * Handle stop button: immediately stop the spinner but keep the partial
   * streamed content visible. The cancelledRef flag tells the in-flight event
   * handler to drop further chunks, but the last-rendered optimistic messages
   * (user prompt + partial assistant reply) remain in place.
   *
   * The Rust backend will still finish and save whatever it generated; once it
   * emits `Done` the regular `onDone` path would invalidate the query and
   * replace optimistic messages with the real persisted ones — but since
   * `cancelledRef` is set, that callback is skipped. The optimistic messages
   * therefore persist until the user sends the next message (which resets them).
   */
  const onCancel = useCallback(async () => {
    cancelledRef.current = true;
    setIsRunning(false);
    // Intentionally do NOT clear optimisticMessages — keep the partial text visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Convert message to ThreadMessageLike
   * Since our messages are already in ThreadMessageLike format, this is a passthrough
   */
  const convertMessage = useCallback(
    (message: ThreadMessageLike) => message,
    []
  );

  // Create the runtime with ExternalStoreAdapter
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    onNew,
    onCancel,
    convertMessage,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
