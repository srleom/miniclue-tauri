import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DownloadProgressPopup } from '@/components/download-progress-popup';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { setLocalChatEnabled } from '@/lib/tauri';
import type {
  Document,
  DocumentStatusChangedEvent,
  DownloadProgress,
} from '@/lib/types';
import {
  BG_DOWNLOAD_MODEL_KEY,
  BG_DOWNLOAD_MODEL_NAME_KEY,
} from '@/components/onboarding/constants';
import { AppSidebar } from '../components/layout/app-sidebar';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function useBackgroundDownload(queryClient: ReturnType<typeof useQueryClient>) {
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>(
    () => localStorage.getItem(BG_DOWNLOAD_MODEL_NAME_KEY) ?? 'AI model'
  );
  const [progress, setProgress] = useState({ downloaded: 0, total: 0 });
  const [isComplete, setIsComplete] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const completedRef = useRef(false);
  const isDismissedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<string>(
    localStorage.getItem(BG_DOWNLOAD_MODEL_NAME_KEY) ?? 'AI model'
  );
  const lastEvtModelIdRef = useRef<string | null>(null);

  const handleClose = () => {
    setIsDismissed(true);
    isDismissedRef.current = true;
  };

  useEffect(() => {
    completedRef.current = false;
    isDismissedRef.current = false;
    lastEvtModelIdRef.current = null;
    setIsDismissed(false);

    // Restore in-progress onboarding background download on mount
    const storedId = localStorage.getItem(BG_DOWNLOAD_MODEL_KEY);
    if (storedId) {
      setModelId(storedId);
      setModelName(
        localStorage.getItem(BG_DOWNLOAD_MODEL_NAME_KEY) ?? 'AI model'
      );
    }

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    const subscribe = async () => {
      const fn = await listen<DownloadProgress>(
        'model-download-progress',
        async (event) => {
          const {
            modelId: evtModelId,
            downloadedBytes,
            totalBytes,
          } = event.payload;

          // Always show popup regardless of download source
          // Only re-read localStorage when a new modelId appears (not on every byte)
          if (evtModelId !== lastEvtModelIdRef.current) {
            lastEvtModelIdRef.current = evtModelId;
            const storedName = localStorage.getItem(BG_DOWNLOAD_MODEL_NAME_KEY);
            if (storedName) nameRef.current = storedName;
          }
          setModelId(evtModelId);
          setModelName(nameRef.current);
          setProgress({ downloaded: downloadedBytes, total: totalBytes });

          if (
            !completedRef.current &&
            totalBytes > 0 &&
            downloadedBytes >= totalBytes
          ) {
            completedRef.current = true;

            // Only call setLocalChatEnabled for onboarding background downloads
            const bgModelId = localStorage.getItem(BG_DOWNLOAD_MODEL_KEY);
            if (bgModelId === evtModelId) {
              try {
                await setLocalChatEnabled(true, evtModelId);
                await queryClient.invalidateQueries({ queryKey: ['models'] });
              } catch (e) {
                console.error('Failed to enable local chat after download:', e);
              }
              localStorage.removeItem(BG_DOWNLOAD_MODEL_KEY);
            }
            localStorage.removeItem(BG_DOWNLOAD_MODEL_NAME_KEY);

            if (isDismissedRef.current) {
              toast.success(`${nameRef.current} downloaded`);
              setModelId(null);
              completedRef.current = false;
              setProgress({ downloaded: 0, total: 0 });
            } else {
              setIsComplete(true);
              if (timerRef.current) clearTimeout(timerRef.current);
              timerRef.current = setTimeout(() => {
                setModelId(null);
                setIsComplete(false);
                completedRef.current = false;
                setProgress({ downloaded: 0, total: 0 });
              }, 3000);
            }
          }
        }
      );
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (unlisten) void unlisten();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [queryClient]);

  return {
    modelId,
    modelName,
    downloaded: progress.downloaded,
    total: progress.total,
    isComplete,
    isDismissed,
    handleClose,
  };
}

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('sidebar_state') !== 'false'
  );
  const queryClient = useQueryClient();
  const bgDownload = useBackgroundDownload(queryClient);

  useEffect(() => {
    localStorage.setItem('sidebar_state', String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const isNewerOrSameUpdate = (
      incomingUpdatedAt: string,
      currentUpdatedAt?: string
    ) => {
      if (!currentUpdatedAt) return true;

      const incomingTimestamp = Date.parse(incomingUpdatedAt);
      const currentTimestamp = Date.parse(currentUpdatedAt);

      if (Number.isNaN(incomingTimestamp) || Number.isNaN(currentTimestamp)) {
        return true;
      }

      return incomingTimestamp >= currentTimestamp;
    };

    const subscribe = async () => {
      unlisten = await listen<DocumentStatusChangedEvent>(
        'document-status-changed',
        (event) => {
          const payload = event.payload;
          if (!payload?.document_id) return;

          queryClient.setQueryData<Document>(
            ['document', payload.document_id],
            (current) => {
              if (!current) return current;
              if (
                !isNewerOrSameUpdate(payload.updated_at, current.updated_at)
              ) {
                return current;
              }

              return {
                ...current,
                status: payload.status,
                error_details: payload.error_details,
                updated_at: payload.updated_at,
              };
            }
          );

          queryClient.setQueryData<{
            status: string;
            error_details: string | null;
          }>(['document', payload.document_id, 'status'], (current) =>
            current
              ? {
                  status: payload.status,
                  error_details: payload.error_details,
                }
              : current
          );

          void queryClient.invalidateQueries({ queryKey: ['folders'] });
          void queryClient.invalidateQueries({ queryKey: ['recents'] });
          void queryClient.invalidateQueries({
            predicate: (query) => {
              if (!Array.isArray(query.queryKey)) return false;
              return (
                query.queryKey[0] === 'folder' &&
                query.queryKey[2] === 'documents'
              );
            },
          });
        }
      );
    };

    void subscribe();

    return () => {
      if (unlisten) {
        void unlisten();
      }
    };
  }, [queryClient]);

  return (
    <div className="relative flex h-dvh w-screen overflow-hidden">
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <AppSidebar />
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 left-0 z-20 border-border border-t"
      />
      {(bgDownload.modelId || bgDownload.isComplete) &&
        !bgDownload.isDismissed && (
          <DownloadProgressPopup
            modelName={bgDownload.modelName}
            downloaded={bgDownload.downloaded}
            total={bgDownload.total}
            isComplete={bgDownload.isComplete}
            onClose={bgDownload.handleClose}
          />
        )}
    </div>
  );
}
