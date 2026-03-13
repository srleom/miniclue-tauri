import { ArrowRight, CheckCircle2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  HardwareProfile,
  LocalModelStatus,
  ModelCatalog,
} from '@/lib/types';
import { Badge } from '../ui/badge';
import { formatBytes } from './constants';

export interface LocalModelStepProps {
  catalog: ModelCatalog | null;
  profile: HardwareProfile | null;
  recommendedId: string | null;
  selectedModelId: string | null;
  modelStatuses: Record<string, LocalModelStatus>;
  onSelectModel: (id: string) => void;
  downloading: boolean;
  onDownload: () => void;
  onUseDownloaded: () => void;
  onContinueInBackground: () => void;
  onSkip: () => void;
}

export function LocalModelStep({
  catalog,
  profile,
  recommendedId,
  selectedModelId,
  modelStatuses,
  onSelectModel,
  downloading,
  onDownload,
  onUseDownloaded,
  onContinueInBackground,
  onSkip,
}: LocalModelStepProps) {
  const ramGb = profile
    ? Math.round(profile.totalRamBytes / (1024 * 1024 * 1024))
    : null;

  const selectedModel = catalog?.models.find((m) => m.id === selectedModelId);
  const selectedIsDownloaded = selectedModelId
    ? (modelStatuses[selectedModelId]?.isDownloaded ?? false)
    : false;

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-1.5">
        <h2 className="text-3xl font-medium tracking-tight">
          Choose your local AI model
        </h2>
        <p className="text-muted-foreground text-sm">
          MiniClue runs AI locally on your device, with no internet required
          after setup.
          {ramGb !== null && ` Your Mac has ${ramGb} GB RAM.`}
        </p>
      </div>

      {/* Model list */}
      {catalog ? (
        <div className="space-y-2">
          {catalog.models.map((m) => {
            const isDownloaded = modelStatuses[m.id]?.isDownloaded ?? false;
            return (
              <button
                key={m.id}
                type="button"
                disabled={downloading}
                onClick={() => onSelectModel(m.id)}
                className={`w-full rounded-xl border px-4 py-3.5 text-left transition-all hover:bg-accent ${
                  selectedModelId === m.id
                    ? 'border-primary bg-accent ring-1 ring-primary'
                    : 'bg-card'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="font-medium">{m.name}</span>
                      {m.id === recommendedId && (
                        <Badge
                          variant="secondary"
                          className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
                        >
                          Recommended
                        </Badge>
                      )}
                      {isDownloaded && (
                        <Badge className="rounded-full px-2 py-0.5 text-[10px] font-semibold gap-1 bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">
                          <CheckCircle2 className="size-2.5" />
                          Downloaded
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      {m.description}
                    </p>
                  </div>
                  <span className="text-muted-foreground mt-0.5 shrink-0 text-xs tabular-nums">
                    {formatBytes(m.sizeBytes)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-muted h-20 animate-pulse rounded-xl border"
            />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-1">
        {!downloading ? (
          <Button
            size="lg"
            className="w-full"
            disabled={!selectedModelId}
            onClick={selectedIsDownloaded ? onUseDownloaded : onDownload}
          >
            {selectedIsDownloaded ? (
              <>
                Use {selectedModel?.name ?? 'model'}
                <ArrowRight className="size-4" />
              </>
            ) : (
              <>
                <Download className="size-4" />
                Download{selectedModel ? ` ${selectedModel.name}` : ' model'}
              </>
            )}
          </Button>
        ) : (
          <Button
            variant="default"
            size="lg"
            className="w-full"
            onClick={onContinueInBackground}
          >
            Continue in background
            <ArrowRight className="size-4" />
          </Button>
        )}

        <Button
          variant="ghost"
          className="w-full gap-2 text-muted-foreground hover:text-foreground hover:bg-transparent"
          disabled={downloading}
          onClick={onSkip}
        >
          Use cloud API
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
