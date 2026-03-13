import { useQueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  HardDrive,
  Layers,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { BG_DOWNLOAD_MODEL_NAME_KEY } from '@/components/onboarding/constants';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  deleteLocalModel,
  getLlamaServerStatus,
  getLocalModelStatus,
  getModelCatalog,
  getRecommendedModelId,
  listModels,
  setLocalChatEnabled,
} from '@/lib/tauri';
import type {
  DownloadProgress,
  LlamaStatus,
  LocalModelStatus,
  ModelCatalog,
} from '@/lib/types';
import { formatBytes } from '@/lib/utils';

function ServerStatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  if (lower === 'running') {
    return (
      <Badge variant="secondary" className="gap-1 text-xs text-green-600">
        <CheckCircle2 className="size-3" />
        Running
      </Badge>
    );
  }
  if (lower === 'starting') {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <span className="size-2 animate-spin rounded-full border border-current border-t-transparent" />
        Starting
      </Badge>
    );
  }
  if (lower === 'failed') {
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <AlertCircle className="size-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      {status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LocalTab() {
  const queryClient = useQueryClient();
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null);
  const [recommendedId, setRecommendedId] = React.useState<string | null>(null);
  const [statuses, setStatuses] = React.useState<
    Record<string, LocalModelStatus>
  >({});
  const [serverStatus, setServerStatus] = React.useState<LlamaStatus | null>(
    null
  );
  const [downloading, setDownloading] = React.useState<
    Record<string, { downloaded: number; total: number }>
  >({});
  // Set of model IDs that are currently enabled in the selector
  const [enabledModelIds, setEnabledModelIds] = React.useState<Set<string>>(
    new Set()
  );
  const [deletingModelId, setDeletingModelId] = React.useState<string | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Load data on mount
  React.useEffect(() => {
    async function load() {
      try {
        const [cat, recId, srvStatus, modelsData] = await Promise.all([
          getModelCatalog(),
          getRecommendedModelId(),
          getLlamaServerStatus(),
          listModels(),
        ]);
        setCatalog(cat);
        setRecommendedId(recId);
        setServerStatus(srvStatus);

        // Derive the set of enabled model IDs from what list_models returns
        // (the "local" provider contains exactly the enabled ones)
        const localProvider = modelsData.providers.find(
          (p) => p.provider === 'local'
        );
        const enabledIds = new Set(
          (localProvider?.models ?? []).map((m) =>
            // strip "local:" prefix to get the raw model ID
            m.id.startsWith('local:') ? m.id.slice('local:'.length) : m.id
          )
        );
        setEnabledModelIds(enabledIds);

        // Load per-model statuses
        const statusMap: Record<string, LocalModelStatus> = {};
        await Promise.all(
          cat.models.map(async (m) => {
            const s = await getLocalModelStatus(m.id);
            statusMap[m.id] = s;
          })
        );
        setStatuses(statusMap);
      } catch (e) {
        setError(String(e));
      }
    }
    void load();
  }, []);

  // Listen for download-progress events
  React.useEffect(() => {
    const unlisten = listen<DownloadProgress>(
      'model-download-progress',
      (event) => {
        const { modelId, downloadedBytes, totalBytes } = event.payload;
        setDownloading((prev) => ({
          ...prev,
          [modelId]: { downloaded: downloadedBytes, total: totalBytes },
        }));
      }
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Shared side-effects for enabling/disabling a model (no busy/toast management)
  async function applyEnabled(modelId: string, enabled: boolean) {
    await setLocalChatEnabled(enabled, modelId);
    setEnabledModelIds((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.add(modelId);
      } else {
        next.delete(modelId);
      }
      return next;
    });
    await queryClient.invalidateQueries({ queryKey: ['models'] });
    const srvStatus = await getLlamaServerStatus();
    setServerStatus(srvStatus);
  }

  async function handleDownload(modelId: string) {
    const modelName =
      catalog?.models.find((m) => m.id === modelId)?.name ?? 'AI model';
    setBusy(true);
    setError(null);
    localStorage.setItem(BG_DOWNLOAD_MODEL_NAME_KEY, modelName);
    try {
      // Start download (fires progress events; returns path when done)
      const { downloadLocalModel } = await import('@/lib/tauri');
      await downloadLocalModel(modelId);
      // Refresh disk status then auto-enable
      const s = await getLocalModelStatus(modelId);
      setStatuses((prev) => ({ ...prev, [modelId]: s }));
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
      await applyEnabled(modelId, true);
      toast.success(`${modelName} downloaded and enabled`);
    } catch (e) {
      setError(`Download failed: ${String(e)}`);
      localStorage.removeItem(BG_DOWNLOAD_MODEL_NAME_KEY);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(modelId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteLocalModel(modelId);
      const s = await getLocalModelStatus(modelId);
      setStatuses((prev) => ({ ...prev, [modelId]: s }));
      // Remove from enabled set if it was there
      setEnabledModelIds((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ['models'] });
      const modelName =
        catalog?.models.find((m) => m.id === modelId)?.name ?? modelId;
      toast.success(`${modelName} deleted`);
    } catch (e) {
      toast.error(`Delete failed: ${String(e)}`);
      setError(`Delete failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled(modelId: string, enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      await applyEnabled(modelId, enabled);
      const modelName =
        catalog?.models.find((m) => m.id === modelId)?.name ?? modelId;
      toast.success(`${modelName} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (e) {
      toast.error(
        `Failed to ${enabled ? 'enable' : 'disable'} local AI: ${String(e)}`
      );
      setError(
        `Failed to ${enabled ? 'enable' : 'disable'} local AI: ${String(e)}`
      );
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Local</h1>
        <p className="text-muted-foreground mt-2">
          Run AI models fully on your device.
        </p>
      </div>

      <div className="mt-8 space-y-8">
        {/* ── Embedding Models ─────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex gap-2">
            <Layers className="text-muted-foreground size-3.5" />
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-tight">
              Embedding
            </h3>
          </div>

          <div className="bg-card border-border/60 rounded-lg border p-4">
            <div className="flex justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  <p className="text-sm font-medium">nomic-embed-text-v1.5</p>
                  <span className="text-muted-foreground/50 text-sm">•</span>
                  <span className="text-muted-foreground text-sm">274 MB</span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs max-w-xs">
                  768-dim text embeddings · Powers document indexing
                </p>
              </div>
            </div>

            <div className="border-border/50 mt-3 flex items-center border-t pt-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="gap-1 text-xs text-green-600"
                >
                  <HardDrive className="size-3" />
                  Downloaded
                </Badge>
                {serverStatus && (
                  <ServerStatusBadge status={serverStatus.embed} />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Chat Models ──────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-start gap-2">
            <MessageSquare className="text-muted-foreground size-3.5" />
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-tight">
              Chat
            </h3>
          </div>

          {catalog.models.map((model) => {
            const st = statuses[model.id];
            const isDownloaded = st?.isDownloaded ?? false;
            const dlProgress = downloading[model.id];
            const isRec = model.id === recommendedId;
            const isEnabled = enabledModelIds.has(model.id);

            return (
              <div
                key={model.id}
                className="bg-card border-border/60 rounded-lg border p-4"
              >
                {/* Model info */}
                <div className="flex justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-1.5">
                      <p className="text-sm font-medium">{model.name}</p>
                      <span className="text-muted-foreground/50 text-sm">
                        •
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {formatBytes(model.sizeBytes)}
                      </span>
                      {isRec && (
                        <Badge variant="secondary" className="text-xs">
                          Recommended
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs max-w-xs">
                      {model.description}
                    </p>
                  </div>

                  {/* Top-right: download button for not-yet-downloaded models */}
                  {!isDownloaded && (
                    <div className="shrink-0">
                      {dlProgress ? (
                        <Button variant="outline" size="sm" disabled>
                          Downloading…
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleDownload(model.id)}
                          className="gap-1.5"
                        >
                          <Download className="size-3.5" />
                          Download
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Download progress bar */}
                {dlProgress && (
                  <div className="mt-3 space-y-1">
                    <Progress
                      value={
                        dlProgress.total > 0
                          ? (dlProgress.downloaded / dlProgress.total) * 100
                          : undefined
                      }
                      className="h-1.5"
                    />
                    <p className="text-muted-foreground text-xs">
                      {formatBytes(dlProgress.downloaded)} /{' '}
                      {dlProgress.total > 0
                        ? formatBytes(dlProgress.total)
                        : '…'}
                    </p>
                  </div>
                )}

                {/* Bottom action row — only for downloaded models */}
                {isDownloaded && (
                  <div className="border-border/50 mt-3 flex justify-between border-t pt-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="gap-1 text-xs text-green-600"
                      >
                        <HardDrive className="size-3" />
                        Downloaded
                      </Badge>
                      {isEnabled && serverStatus && (
                        <ServerStatusBadge status={serverStatus.chat} />
                      )}
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={busy}
                        onClick={() => setDeletingModelId(model.id)}
                        aria-label={`Delete ${model.name}`}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`enable-${model.id}`}
                          className="text-muted-foreground cursor-pointer text-xs"
                        >
                          {isEnabled ? 'Enabled' : 'Enable'}
                        </Label>
                        <Switch
                          id={`enable-${model.id}`}
                          checked={isEnabled}
                          disabled={busy}
                          onCheckedChange={(v) =>
                            handleToggleEnabled(model.id, v)
                          }
                          aria-label={`Use ${model.name} for local chat`}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Delete confirmation dialog */}
        <AlertDialog
          open={deletingModelId !== null}
          onOpenChange={(open) => {
            if (!open) setDeletingModelId(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete model?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete{' '}
                <strong>
                  {catalog.models.find((m) => m.id === deletingModelId)?.name ??
                    deletingModelId}
                </strong>{' '}
                from your device. You can re-download it later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => {
                  if (deletingModelId) {
                    void handleDelete(deletingModelId);
                    setDeletingModelId(null);
                  }
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="mt-1 size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
