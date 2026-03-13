import { CheckCircle2, X } from 'lucide-react';
import { formatBytes } from '@/components/onboarding/constants';
import { Progress } from '@/components/ui/progress';

interface DownloadProgressPopupProps {
  modelName: string;
  downloaded: number;
  total: number;
  isComplete: boolean;
  onClose?: () => void;
}

export function DownloadProgressPopup({
  modelName,
  downloaded,
  total,
  isComplete,
  onClose,
}: DownloadProgressPopupProps) {
  const pct = isComplete ? 100 : total > 0 ? (downloaded / total) * 100 : 0;

  return (
    <div className="animate-in fade-in-0 slide-in-from-top-4 fixed right-4 top-4 z-50 w-72 rounded-xl border bg-card p-4 shadow-lg duration-200">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="truncate text-sm font-medium leading-none">
            {modelName}
          </p>
          {!isComplete && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground -mr-1 ml-2 shrink-0 rounded p-0.5 transition-colors"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between">
          {isComplete ? (
            <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-3.5 shrink-0" />
              Download complete
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">Downloading…</span>
          )}
          {!isComplete && total > 0 && (
            <span className="text-muted-foreground shrink-0 tabular-nums text-xs">
              {formatBytes(downloaded)} / {formatBytes(total)}
            </span>
          )}
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>
    </div>
  );
}
