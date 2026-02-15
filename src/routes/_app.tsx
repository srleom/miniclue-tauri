import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { AppSidebar } from '../components/layout/app-sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import type { Document, DocumentStatusChangedEvent } from '@/lib/types';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('sidebar_state') !== 'false'
  );
  const queryClient = useQueryClient();

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
    </div>
  );
}
