import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Thread } from '@/components/assistant-ui/thread';
import { ChatHeader } from '@/components/document/chat-header';
import { Badge } from '@/components/ui/badge';
import { ChatRuntimeProvider } from '@/lib/chat/chat-runtime-provider';
import { useChats, useCreateChat } from '@/lib/chat/use-chat-queries';
import { useSelectedModel } from '@/lib/model-context';
import { listModels } from '@/lib/tauri';

interface ChatPanelProps {
  documentId: string;
  status: string;
}

type ProcessingStatus = 'pending_processing' | 'parsing' | 'processing';

const PROCESSING_STATUS_META: Record<
  ProcessingStatus,
  {
    badge: string;
    badgeClassName: string;
  }
> = {
  pending_processing: {
    badge: 'Queued',
    badgeClassName:
      'border-slate-300/70 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300',
  },
  parsing: {
    badge: 'Parsing PDF',
    badgeClassName:
      'border-sky-300/70 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  },
  processing: {
    badge: 'Embedding',
    badgeClassName:
      'border-amber-300/70 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  },
};

const isProcessingStatus = (status: string): status is ProcessingStatus =>
  status === 'pending_processing' ||
  status === 'parsing' ||
  status === 'processing';

/**
 * Chat panel component that displays the chat UI for a document
 *
 * Features:
 * - Auto-creates first chat if none exist
 * - Editable chat title with history dropdown and new chat button
 * - Model selector in composer (input area)
 * - Full chat UI with streaming support
 * - Disabled during document processing
 */
export function ChatPanel({ documentId, status }: ChatPanelProps) {
  const { data: modelsData } = useQuery({
    queryKey: ['models'],
    queryFn: listModels,
    staleTime: 10 * 60 * 1000,
  });

  // Derive default model: prefer local AI if available, otherwise first enabled model.
  // Returns empty string when no models are configured — the ModelSelector will show
  // "No models available" and the user can open settings to configure one.
  const defaultModel = (() => {
    if (!modelsData) return null; // still loading
    const allModels = modelsData.providers.flatMap((p) =>
      p.models
        .filter((m) => m.enabled)
        .map((m) => ({ provider: p.provider, id: m.id }))
    );
    const local = allModels.find((m) => m.provider === 'local');
    if (local) return local.id;
    return allModels[0]?.id ?? ''; // empty string = no models, but don't block
  })();

  const { selectedModel, setSelectedModel } = useSelectedModel();

  // Once we have a default model (including empty string), seed it if not yet set.
  // Also resets the stored model if it is no longer in the enabled list (e.g. was
  // disabled after being saved to localStorage).
  useEffect(() => {
    if (defaultModel === null) return; // still loading

    // Seed on first load
    if (selectedModel === null) {
      setSelectedModel(defaultModel);
      return;
    }

    // Auto-select when models first become available (selectedModel '' = no models existed)
    // or reset if the stored model was disabled/removed from the enabled list
    const enabledIds =
      modelsData?.providers.flatMap((p) =>
        p.models.filter((m) => m.enabled).map((m) => m.id)
      ) ?? [];
    if (
      (selectedModel === '' && defaultModel !== '') ||
      (selectedModel !== '' && !enabledIds.includes(selectedModel))
    ) {
      setSelectedModel(defaultModel);
    }
  }, [defaultModel, selectedModel, setSelectedModel, modelsData]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const processingState = isProcessingStatus(status)
    ? PROCESSING_STATUS_META[status]
    : null;
  const isFailed = status === 'failed';

  const { data: chats = [], isLoading: isLoadingChats } = useChats(documentId);
  const createChatMutation = useCreateChat(documentId);

  // Track if we've already initialized a chat for this document
  const hasInitializedRef = useRef(false);
  // Track previous processing state to detect completion
  const prevProcessingStateRef = useRef(processingState);

  // Ensure chat selection when processing completes
  useEffect(() => {
    // Detect processing completion (was processing, now not)
    if (prevProcessingStateRef.current && !processingState) {
      // Processing just completed - ensure a chat is selected
      if (!currentChatId && chats.length > 0) {
        console.log('Processing completed, ensuring chat selection');
        setCurrentChatId(chats[0].id);
      }
    }
    prevProcessingStateRef.current = processingState;
  }, [processingState, currentChatId, chats]);

  // Auto-create first chat if none exist and ensure selection reliability
  // biome-ignore lint/correctness/useExhaustiveDependencies: createChatMutation.mutateAsync is intentionally excluded to prevent duplicate chat creation on mutation state changes
  useEffect(() => {
    const initializeChat = async () => {
      // Skip if already initialized or currently initializing
      if (hasInitializedRef.current) return;

      if (!isLoadingChats && chats.length === 0) {
        hasInitializedRef.current = true; // Mark as initialized BEFORE async call

        try {
          const newChat = await createChatMutation.mutateAsync({
            title: 'New Chat',
          });
          // Verify new chat has valid ID before setting
          if (newChat?.id) {
            setCurrentChatId(newChat.id);
          } else {
            console.error('Created chat has no ID');
            hasInitializedRef.current = false; // Reset to allow retry
          }
        } catch (error) {
          console.error('Error creating initial chat:', error);
          hasInitializedRef.current = false; // Reset on error to allow retry
        }
      } else if (chats.length > 0 && !currentChatId) {
        // Set first chat as current if not already set
        setCurrentChatId(chats[0].id);
      }
    };

    initializeChat();
  }, [chats, isLoadingChats, currentChatId]);

  if (isLoadingChats || !currentChatId || selectedModel === null) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // selectedModel is guaranteed non-null past this point
  const currentModel: string = selectedModel;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header with chat title and action buttons */}
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <ChatHeader
          documentId={documentId}
          chatId={currentChatId}
          onChatChange={setCurrentChatId}
        />
      </div>

      {/* Chat UI */}
      <div className="flex-1 overflow-hidden">
        {processingState ? (
          <div className="flex h-full items-center justify-center p-5">
            <div className="flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              <Badge
                variant="outline"
                className={`text-xs ${processingState.badgeClassName}`}
              >
                {processingState.badge}
              </Badge>
            </div>
          </div>
        ) : (
          <ChatRuntimeProvider
            key={currentChatId}
            documentId={documentId}
            chatId={currentChatId}
            model={currentModel}
          >
            <Thread
              selectedModel={currentModel}
              onModelChange={setSelectedModel}
              processingFailed={isFailed}
            />
          </ChatRuntimeProvider>
        )}
      </div>
    </div>
  );
}
