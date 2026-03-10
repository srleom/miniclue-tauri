import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { listen } from '@tauri-apps/api/event';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Sparkles,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import {
  downloadLocalModel,
  getHardwareProfile,
  getModelCatalog,
  getRecommendedModelId,
  setLocalChatEnabled,
} from '@/lib/tauri';
import type {
  DownloadProgress,
  HardwareProfile,
  ModelCatalog,
} from '@/lib/types';

export const ONBOARDING_DONE_KEY = 'miniclue_onboarding_done';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function OnboardingPage() {
  const navigate = useNavigate();

  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null);
  const [profile, setProfile] = React.useState<HardwareProfile | null>(null);
  const [recommendedId, setRecommendedId] = React.useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = React.useState<string | null>(
    null
  );

  const [downloading, setDownloading] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    downloaded: number;
    total: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  // Load catalog + hardware profile
  React.useEffect(() => {
    async function load() {
      try {
        const [cat, recId, hw] = await Promise.all([
          getModelCatalog(),
          getRecommendedModelId(),
          getHardwareProfile(),
        ]);
        setCatalog(cat);
        setRecommendedId(recId);
        setProfile(hw);
        setSelectedModelId(recId);
      } catch (e) {
        setError(String(e));
      }
    }
    void load();
  }, []);

  // Listen for download progress events
  React.useEffect(() => {
    const unlisten = listen<DownloadProgress>(
      'model-download-progress',
      (event) => {
        const { modelId, downloadedBytes, totalBytes } = event.payload;
        if (modelId === selectedModelId) {
          setProgress({ downloaded: downloadedBytes, total: totalBytes });
        }
      }
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [selectedModelId]);

  async function handleDownload() {
    if (!selectedModelId) return;
    setDownloading(true);
    setError(null);
    setProgress(null);
    try {
      await downloadLocalModel(selectedModelId);
      await setLocalChatEnabled(true, selectedModelId);
      localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
      await navigate({ to: '/' });
    } catch (e) {
      setError(`Download failed: ${String(e)}`);
      setDownloading(false);
      setProgress(null);
    }
  }

  async function handleSkip() {
    localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
    await navigate({ to: '/' });
  }

  const recommended = catalog?.models.find((m) => m.id === recommendedId);
  const selected = catalog?.models.find((m) => m.id === selectedModelId);
  const ramGb = profile
    ? Math.round(profile.totalRamBytes / (1024 * 1024 * 1024))
    : null;

  const progressPct =
    progress && progress.total > 0
      ? (progress.downloaded / progress.total) * 100
      : undefined;

  return (
    <div className="flex h-dvh w-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Logo / Icon */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="size-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Set up local AI
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              MiniClue runs AI on your device — no API key or internet required
              after setup.
            </p>
          </div>
        </div>

        {/* Recommended model card */}
        {recommended && (
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{recommended.name}</p>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {recommended.description}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatBytes(recommended.sizeBytes)}
                  {ramGb !== null ? ` · Your device: ${ramGb} GB RAM` : ''}
                </p>
              </div>
            </div>

            {/* Progress */}
            {downloading && (
              <div className="mt-4 space-y-1.5">
                <Progress value={progressPct} className="h-2" />
                <p className="text-muted-foreground text-xs">
                  {progress
                    ? `${formatBytes(progress.downloaded)} / ${progress.total > 0 ? formatBytes(progress.total) : '…'}`
                    : 'Starting download…'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            className="w-full"
            disabled={!selectedModelId || downloading}
            onClick={handleDownload}
          >
            {downloading ? (
              'Downloading…'
            ) : (
              <>
                <Download className="mr-2 size-4" />
                Download{selected ? ` ${selected.name}` : ' model'}
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            disabled={downloading}
            onClick={handleSkip}
          >
            Use cloud API instead
          </Button>
        </div>

        {/* Advanced: model picker */}
        {catalog && catalog.models.length > 1 && (
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-1 text-xs text-muted-foreground"
              >
                Advanced
                {advancedOpen ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-2">
              <p className="text-muted-foreground text-xs">
                Choose a different model tier:
              </p>
              {catalog.models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModelId(m.id)}
                  className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors hover:bg-accent ${
                    selectedModelId === m.id ? 'border-primary bg-accent' : ''
                  }`}
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {formatBytes(m.sizeBytes)} · {m.minRamGb}+ GB RAM
                  </span>
                  {m.id === recommendedId && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      (recommended)
                    </span>
                  )}
                </button>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
