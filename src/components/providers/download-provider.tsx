import { useQueryClient } from '@tanstack/react-query';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as React from 'react';
import { toast } from 'sonner';
import { DownloadProgressPopup } from '@/components/download-progress-popup';
import {
  BG_DOWNLOAD_MODEL_KEY,
  BG_DOWNLOAD_MODEL_NAME_KEY,
} from '@/components/onboarding/constants';
import { downloadLocalModel, setLocalChatEnabled } from '@/lib/tauri';
import type { DownloadProgress } from '@/lib/types';

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

interface DownloadActionsContextValue {
  /**
   * Initiates a model download, shows the progress popup, and calls
   * setLocalChatEnabled + invalidates ['models'] on completion.
   *
   * Returns a Promise that resolves (or rejects) when the download is
   * finished, so callers can do post-download UI work (e.g. navigating to the
   * next onboarding step, refreshing model status).
   */
  startDownload: (modelId: string, modelName: string) => Promise<void>;
}

interface DownloadStateContextValue {
  /** The model ID currently being downloaded, or null when idle. */
  activeModelId: string | null;
  /** Bytes downloaded so far (0 when idle). */
  activeDownloaded: number;
  /** Total bytes expected (0 when idle or unknown). */
  activeTotal: number;
}

const DownloadActionsContext =
  React.createContext<DownloadActionsContextValue | null>(null);

const DownloadStateContext =
  React.createContext<DownloadStateContextValue | null>(null);

/** Returns stable download actions. Safe to call anywhere inside <DownloadProvider>. */
export function useDownload() {
  const ctx = React.useContext(DownloadActionsContext);
  if (!ctx)
    throw new Error('useDownload must be used within <DownloadProvider>');
  return ctx;
}

/** Returns live download progress state. Re-renders on every progress tick. */
export function useDownloadState() {
  const ctx = React.useContext(DownloadStateContext);
  if (!ctx)
    throw new Error('useDownloadState must be used within <DownloadProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Popup display state
  const [activeModelId, setActiveModelId] = React.useState<string | null>(null);
  const [activeModelName, setActiveModelName] = React.useState('');
  const [downloaded, setDownloaded] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [isComplete, setIsComplete] = React.useState(false);
  const [isDismissed, setIsDismissed] = React.useState(false);

  // Refs for stable access inside async callbacks — never go stale
  const isDismissedRef = React.useRef(false);
  const completedRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keeps the current model name accessible from handleClose without a stale closure
  const activeModelNameRef = React.useRef('');

  React.useEffect(() => {
    activeModelNameRef.current = activeModelName;
  }, [activeModelName]);

  // ── Stable helpers (only use setters and refs, so deps = []) ─────────────

  /** Cancel the auto-hide timer if one is running. */
  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Reset all popup state back to idle. */
  const resetPopup = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setActiveModelId(null);
    setActiveModelName('');
    setDownloaded(0);
    setTotal(0);
    setIsComplete(false);
    setIsDismissed(false);
    isDismissedRef.current = false;
    completedRef.current = false;
  }, []);

  /**
   * Called when a download finishes (from startDownload OR background
   * recovery). Decides whether to show the "complete" banner in the popup
   * (and auto-hide after 3 s) or to fire a toast immediately if the popup
   * was already dismissed.
   */
  const finishDownload = React.useCallback(
    (modelName: string) => {
      if (isDismissedRef.current) {
        toast.success(`${modelName} downloaded`);
        resetPopup();
      } else {
        setIsComplete(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(resetPopup, 3000);
      }
    },
    [resetPopup]
  );

  /**
   * X button on the popup.
   * • Download already finished → toast + hide immediately.
   * • Download still running   → mark dismissed (toast fires when done).
   */
  const handleClose = React.useCallback(() => {
    if (completedRef.current) {
      toast.success(`${activeModelNameRef.current} downloaded`);
      resetPopup();
    } else {
      setIsDismissed(true);
      isDismissedRef.current = true;
    }
  }, [resetPopup]);

  // ── Background recovery ───────────────────────────────────────────────────
  //
  // If the user started a download in onboarding, clicked "Continue in
  // background", and completed onboarding before the download finished,
  // BG_DOWNLOAD_MODEL_KEY will be present in localStorage when the app
  // layout mounts.  Resume tracking — the Rust download is already running.

  React.useEffect(() => {
    const bgModelId = localStorage.getItem(BG_DOWNLOAD_MODEL_KEY);
    if (!bgModelId) return;

    const bgModelName =
      localStorage.getItem(BG_DOWNLOAD_MODEL_NAME_KEY) ?? 'AI model';

    setActiveModelId(bgModelId);
    setActiveModelName(bgModelName);
    activeModelNameRef.current = bgModelName;
    completedRef.current = false;
    isDismissedRef.current = false;
    setIsDismissed(false);

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
          if (evtModelId !== bgModelId) return;

          setDownloaded(downloadedBytes);
          setTotal(totalBytes);

          if (
            !completedRef.current &&
            totalBytes > 0 &&
            downloadedBytes >= totalBytes
          ) {
            completedRef.current = true;
            try {
              await setLocalChatEnabled(true, evtModelId);
              await queryClient.invalidateQueries({ queryKey: ['models'] });
              await queryClient.invalidateQueries({
                queryKey: ['localModelStatus', evtModelId],
              });
              await queryClient.invalidateQueries({
                queryKey: ['llamaServerStatus'],
              });
            } catch (e) {
              console.error(
                'Failed to enable local chat after background download:',
                e
              );
            }
            localStorage.removeItem(BG_DOWNLOAD_MODEL_KEY);
            localStorage.removeItem(BG_DOWNLOAD_MODEL_NAME_KEY);
            finishDownload(bgModelName);
          }
        }
      );
      if (cancelled) fn();
      else unlisten = fn;
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (unlisten) void unlisten();
    };
  }, [queryClient, finishDownload]);

  // ── startDownload ─────────────────────────────────────────────────────────

  const startDownload = React.useCallback(
    async (modelId: string, modelName: string): Promise<void> => {
      // Reset any leftover state from a previous download
      clearTimer();
      completedRef.current = false;
      isDismissedRef.current = false;

      setActiveModelId(modelId);
      setActiveModelName(modelName);
      activeModelNameRef.current = modelName;
      setDownloaded(0);
      setTotal(0);
      setIsComplete(false);
      setIsDismissed(false);

      // Subscribe to progress events for the live progress bar
      const unlistenPromise = listen<DownloadProgress>(
        'model-download-progress',
        (event) => {
          const {
            modelId: evtModelId,
            downloadedBytes,
            totalBytes,
          } = event.payload;
          if (evtModelId !== modelId) return;
          setDownloaded(downloadedBytes);
          setTotal(totalBytes);
        }
      );

      let unlisten: UnlistenFn | null = null;
      try {
        await downloadLocalModel(modelId);
        await setLocalChatEnabled(true, modelId);
        await queryClient.invalidateQueries({ queryKey: ['models'] });
        await queryClient.invalidateQueries({
          queryKey: ['localModelStatus', modelId],
        });
        await queryClient.invalidateQueries({
          queryKey: ['llamaServerStatus'],
        });
        completedRef.current = true;
        finishDownload(modelName);
      } catch (e) {
        // Hide popup on error; re-throw so caller can show an error message
        resetPopup();
        throw e;
      } finally {
        unlisten = await unlistenPromise;
        unlisten();
      }
    },
    [queryClient, clearTimer, finishDownload, resetPopup]
  );

  // ── Context values ────────────────────────────────────────────────────────

  // Stable — only startDownload is in here; won't cause re-renders in consumers
  const actionsValue = React.useMemo(
    () => ({ startDownload }),
    [startDownload]
  );

  // Changes on every progress event — split so actions consumers don't re-render
  const stateValue = React.useMemo(
    () => ({
      activeModelId,
      activeDownloaded: downloaded,
      activeTotal: total,
    }),
    [activeModelId, downloaded, total]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const showPopup = activeModelId !== null && !isDismissed;

  return (
    <DownloadActionsContext.Provider value={actionsValue}>
      <DownloadStateContext.Provider value={stateValue}>
        {children}
        {showPopup && (
          <DownloadProgressPopup
            modelName={activeModelName}
            downloaded={downloaded}
            total={total}
            isComplete={isComplete}
            onClose={handleClose}
          />
        )}
      </DownloadStateContext.Provider>
    </DownloadActionsContext.Provider>
  );
}
