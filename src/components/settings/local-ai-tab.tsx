import { listen } from '@tauri-apps/api/event';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  HardDrive,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  deleteLocalModel,
  getLlamaServerStatus,
  getLocalModelStatus,
  getModelCatalog,
  getRecommendedModelId,
  setLocalChatEnabled,
} from '@/lib/tauri';
import type {
  DownloadProgress,
  LlamaStatus,
  LocalModelStatus,
  ModelCatalog,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

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

export function LocalAITab() {
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
  const [localEnabled, setLocalEnabled] = React.useState(false);
  const [activeModelId, setActiveModelId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Load data on mount
  React.useEffect(() => {
    async function load() {
      try {
        const [cat, recId, srvStatus] = await Promise.all([
          getModelCatalog(),
          getRecommendedModelId(),
          getLlamaServerStatus(),
        ]);
        setCatalog(cat);
        setRecommendedId(recId);
        setServerStatus(srvStatus);

        // Load per-model statuses
        const statusMap: Record<string, LocalModelStatus> = {};
        await Promise.all(
          cat.models.map(async (m) => {
            const s = await getLocalModelStatus(m.id);
            statusMap[m.id] = s;
          })
        );
        setStatuses(statusMap);

        // Determine currently active model from server status + downloaded models
        const downloaded = cat.models.find(
          (m) => statusMap[m.id]?.isDownloaded
        );
        if (downloaded) {
          setActiveModelId(downloaded.id);
          setLocalEnabled(srvStatus.chat.toLowerCase() !== 'stopped');
        }
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

  async function handleDownload(modelId: string) {
    setBusy(true);
    setError(null);
    try {
      // Start download (fires progress events; returns path when done)
      const { downloadLocalModel } = await import('@/lib/tauri');
      await downloadLocalModel(modelId);
      // Refresh status
      const s = await getLocalModelStatus(modelId);
      setStatuses((prev) => ({ ...prev, [modelId]: s }));
      setActiveModelId(modelId);
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    } catch (e) {
      setError(`Download failed: ${String(e)}`);
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
      if (activeModelId === modelId) {
        setActiveModelId(null);
        setLocalEnabled(false);
      }
    } catch (e) {
      setError(`Delete failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled(modelId: string, enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setLocalChatEnabled(enabled, modelId);
      setLocalEnabled(enabled);
      setActiveModelId(modelId);
      const srvStatus = await getLlamaServerStatus();
      setServerStatus(srvStatus);
    } catch (e) {
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold">Local AI</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Run AI fully on your device — no API keys required. Chat models are
          downloaded once and work completely offline.
        </p>
      </div>

      {/* Embed server status */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Embedding server</p>
            <p className="text-muted-foreground text-xs">
              Always-on · port 28881 · powers document indexing
            </p>
          </div>
          {serverStatus ? (
            <ServerStatusBadge status={serverStatus.embed} />
          ) : (
            <Badge variant="outline" className="text-xs">
              —
            </Badge>
          )}
        </div>
      </div>

      <Separator />

      {/* Model list */}
      <div className="space-y-3">
        <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-tighter">
          Chat Models
        </h3>

        {catalog.models.map((model) => {
          const st = statuses[model.id];
          const isDownloaded = st?.isDownloaded ?? false;
          const dlProgress = downloading[model.id];
          const isRec = model.id === recommendedId;
          const isActive = model.id === activeModelId;

          return (
            <div key={model.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{model.name}</p>
                    {isRec && (
                      <Badge variant="secondary" className="text-xs">
                        Recommended
                      </Badge>
                    )}
                    {isDownloaded && (
                      <Badge
                        variant="outline"
                        className="gap-1 text-xs text-green-600"
                      >
                        <HardDrive className="size-3" />
                        Downloaded
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {model.description} · {formatBytes(model.sizeBytes)}
                  </p>

                  {/* Download progress bar */}
                  {dlProgress && (
                    <div className="mt-2 space-y-1">
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
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-2">
                  {isDownloaded ? (
                    <>
                      {/* Enable/disable toggle */}
                      <div className="flex items-center gap-1.5">
                        {isActive && serverStatus && (
                          <ServerStatusBadge status={serverStatus.chat} />
                        )}
                        <Switch
                          checked={isActive && localEnabled}
                          disabled={busy}
                          onCheckedChange={(v) =>
                            handleToggleEnabled(model.id, v)
                          }
                          aria-label={`Use ${model.name} for local chat`}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        onClick={() => handleDelete(model.id)}
                        aria-label={`Delete ${model.name}`}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </>
                  ) : dlProgress ? (
                    <Button variant="outline" size="sm" disabled>
                      Downloading…
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleDownload(model.id)}
                    >
                      <Download className="mr-1.5 size-3.5" />
                      Download
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
