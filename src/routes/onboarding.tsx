import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { listen } from '@tauri-apps/api/event';
import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { DownloadProgressPopup } from '@/components/download-progress-popup';
import { ApiKeysStep } from '@/components/onboarding/api-keys-step';
import {
  BG_DOWNLOAD_MODEL_KEY,
  BG_DOWNLOAD_MODEL_NAME_KEY,
  ONBOARDING_DONE_KEY,
  type OnboardingStep,
  STEPS,
} from '@/components/onboarding/constants';
import { LocalModelStep } from '@/components/onboarding/local-model-step';
import { WelcomeStep } from '@/components/onboarding/welcome-step';
import { Button } from '@/components/ui/button';
import {
  downloadLocalModel,
  getHardwareProfile,
  getLocalModelStatus,
  getModelCatalog,
  getRecommendedModelId,
  setLocalChatEnabled,
} from '@/lib/tauri';
import type {
  DownloadProgress,
  HardwareProfile,
  LocalModelStatus,
  ModelCatalog,
} from '@/lib/types';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = React.useState<OnboardingStep>('welcome');

  // Model state
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null);
  const [profile, setProfile] = React.useState<HardwareProfile | null>(null);
  const [recommendedId, setRecommendedId] = React.useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = React.useState<string | null>(
    null
  );
  const [modelStatuses, setModelStatuses] = React.useState<
    Record<string, LocalModelStatus>
  >({});
  const [downloading, setDownloading] = React.useState(false);
  const [downloadComplete, setDownloadComplete] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const dismissedRef = React.useRef(false);
  const [downloadProgress, setDownloadProgress] = React.useState<{
    downloaded: number;
    total: number;
  } | null>(null);
  const completionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Clean up completion timer on unmount
  React.useEffect(() => {
    return () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, []);

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

        const statuses = await Promise.all(
          cat.models.map((m) => getLocalModelStatus(m.id))
        );
        const statusMap: Record<string, LocalModelStatus> = {};
        for (const s of statuses) statusMap[s.modelId] = s;
        setModelStatuses(statusMap);

        setSelectedModelId(recId);
      } catch (e) {
        console.error('Failed to load model catalog:', e);
      }
    }
    void load();
  }, []);

  React.useEffect(() => {
    const unlisten = listen<DownloadProgress>(
      'model-download-progress',
      (event) => {
        const { modelId, downloadedBytes, totalBytes } = event.payload;
        if (modelId === selectedModelId) {
          setDownloadProgress({
            downloaded: downloadedBytes,
            total: totalBytes,
          });
        }
      }
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [selectedModelId]);

  const handleClose = () => {
    setDismissed(true);
    dismissedRef.current = true;
  };

  async function handleDownload() {
    if (!selectedModelId) return;
    const modelName =
      catalog?.models.find((m) => m.id === selectedModelId)?.name ?? 'AI model';
    setDownloading(true);
    setDownloadComplete(false);
    setDismissed(false);
    dismissedRef.current = false;
    setDownloadProgress(null);
    localStorage.setItem(BG_DOWNLOAD_MODEL_KEY, selectedModelId);
    localStorage.setItem(BG_DOWNLOAD_MODEL_NAME_KEY, modelName);
    try {
      await downloadLocalModel(selectedModelId);
      await setLocalChatEnabled(true, selectedModelId);
      await queryClient.invalidateQueries({ queryKey: ['models'] });
      localStorage.removeItem(BG_DOWNLOAD_MODEL_KEY);
      localStorage.removeItem(BG_DOWNLOAD_MODEL_NAME_KEY);
      setDownloading(false);
      setStep('api-keys');
      if (dismissedRef.current) {
        toast.success(`${modelName} downloaded`);
      } else {
        setDownloadComplete(true);
        if (completionTimerRef.current)
          clearTimeout(completionTimerRef.current);
        completionTimerRef.current = setTimeout(() => {
          setDownloadComplete(false);
          setDownloadProgress(null);
        }, 3000);
      }
    } catch (e) {
      console.error('Download failed:', e);
      setDownloading(false);
      setDownloadComplete(false);
      localStorage.removeItem(BG_DOWNLOAD_MODEL_KEY);
      localStorage.removeItem(BG_DOWNLOAD_MODEL_NAME_KEY);
    }
  }

  async function handleUseDownloaded() {
    if (!selectedModelId) return;
    try {
      await setLocalChatEnabled(true, selectedModelId);
      await queryClient.invalidateQueries({ queryKey: ['models'] });
      setStep('api-keys');
    } catch (e) {
      console.error('Failed to enable local model:', e);
    }
  }

  async function handleFinish() {
    localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
    await navigate({ to: '/' });
  }

  const stepIndex = STEPS.indexOf(step);

  function handleBack() {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev);
  }

  return (
    <div className="flex h-dvh w-screen flex-col bg-background">
      {/* Sticky header — opaque so scrolled content never bleeds through */}
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center bg-background px-2">
        {stepIndex > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="gap-1"
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
        )}
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === stepIndex
                  ? 'w-8 bg-primary'
                  : i < stepIndex
                    ? 'w-5 bg-primary/40'
                    : 'w-5 bg-border'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Welcome: vertically centered; others: top-aligned */}
        <div
          className={
            step === 'welcome'
              ? 'flex min-h-full items-center -mt-6 justify-center p-6'
              : 'mx-auto w-full max-w-[420px] px-6 pt-10 pb-10'
          }
        >
          <div
            key={step}
            className={`animate-in fade-in-0 slide-in-from-bottom-3 w-full duration-300 ${
              step === 'welcome' ? 'max-w-[560px]' : ''
            }`}
          >
            {step === 'welcome' && (
              <WelcomeStep onNext={() => setStep('model')} />
            )}
            {step === 'model' && (
              <LocalModelStep
                catalog={catalog}
                profile={profile}
                recommendedId={recommendedId}
                selectedModelId={selectedModelId}
                modelStatuses={modelStatuses}
                onSelectModel={setSelectedModelId}
                downloading={downloading}
                onDownload={handleDownload}
                onUseDownloaded={handleUseDownloaded}
                onContinueInBackground={() => setStep('api-keys')}
                onSkip={() => setStep('api-keys')}
              />
            )}
            {step === 'api-keys' && <ApiKeysStep onFinish={handleFinish} />}
          </div>
        </div>
      </div>
      {(downloading || downloadComplete) && !dismissed && (
        <DownloadProgressPopup
          modelName={
            catalog?.models.find((m) => m.id === selectedModelId)?.name ??
            'AI model'
          }
          downloaded={downloadProgress?.downloaded ?? 0}
          total={downloadProgress?.total ?? 0}
          isComplete={downloadComplete}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
