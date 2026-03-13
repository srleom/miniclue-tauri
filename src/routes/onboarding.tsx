import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
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
import { useDownload } from '@/components/providers/download-provider';
import { useLocalModelCatalog } from '@/hooks/use-local-model-catalog';
import { getHardwareProfile, setLocalChatEnabled } from '@/lib/tauri';
import type { HardwareProfile } from '@/lib/types';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { startDownload } = useDownload();

  const [step, setStep] = React.useState<OnboardingStep>('welcome');

  // Catalog + statuses
  const {
    catalog,
    recommendedId,
    statuses: modelStatuses,
  } = useLocalModelCatalog();

  // Onboarding-specific state
  const [profile, setProfile] = React.useState<HardwareProfile | null>(null);
  const [selectedModelId, setSelectedModelId] = React.useState<string | null>(
    null
  );
  const [downloading, setDownloading] = React.useState(false);

  // Load hardware profile
  React.useEffect(() => {
    getHardwareProfile()
      .then(setProfile)
      .catch((e) => console.error('Failed to load hardware profile:', e));
  }, []);

  // Once the catalog loads, default the selection to the recommended model
  React.useEffect(() => {
    if (recommendedId !== null && selectedModelId === null) {
      setSelectedModelId(recommendedId);
    }
  }, [recommendedId, selectedModelId]);

  async function handleDownload() {
    if (!selectedModelId) return;
    const modelName =
      catalog?.models.find((m) => m.id === selectedModelId)?.name ?? 'AI model';

    setDownloading(true);

    // Store in localStorage so the background-recovery path in DownloadProvider
    // can resume if the user completes onboarding before the download finishes.
    localStorage.setItem(BG_DOWNLOAD_MODEL_KEY, selectedModelId);
    localStorage.setItem(BG_DOWNLOAD_MODEL_NAME_KEY, modelName);

    try {
      await startDownload(selectedModelId, modelName);
      // startDownload already called setLocalChatEnabled + invalidated queries
      localStorage.removeItem(BG_DOWNLOAD_MODEL_KEY);
      localStorage.removeItem(BG_DOWNLOAD_MODEL_NAME_KEY);
      setStep('api-keys');
    } catch (e) {
      console.error('Download failed:', e);
      localStorage.removeItem(BG_DOWNLOAD_MODEL_KEY);
      localStorage.removeItem(BG_DOWNLOAD_MODEL_NAME_KEY);
    } finally {
      setDownloading(false);
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
    </div>
  );
}
