'use client';

// react
import { useCallback, useEffect, useMemo, useState } from 'react';

// third-party
import { toast } from 'sonner';

// components
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { ApiKeyDialog } from '@/components/settings/api-key-dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
// icons
import { ChevronDown, Cpu, Plus } from 'lucide-react';

// code
import {
  providerDisplayNames,
  providerLogos,
} from '@/components/settings/provider-constants';
import type { Provider } from '@/lib/types';
import { useUpdateModelPreference } from '@/hooks/use-queries';

type ProviderModels = {
  provider: Provider;
  models: { id: string; name: string; enabled: boolean }[];
  hasKey: boolean;
};

type ModelsListProps = {
  providers: ProviderModels[];
};

export function ModelsList({ providers }: ModelsListProps) {
  const [state, setState] = useState<ProviderModels[]>(providers);
  const updateModelPreference = useUpdateModelPreference();

  useEffect(() => {
    setState(providers);
  }, [providers]);

  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(
    null
  );
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);

  const handleAddApiKey = useCallback((provider: Provider) => {
    setSelectedProvider(provider);
    setIsApiKeyDialogOpen(true);
  }, []);

  const handleApiKeySuccess = () => {
    setIsApiKeyDialogOpen(false);
    setSelectedProvider(null);
    toast.success('API key added!');
  };

  const hasProviders = state.length > 0;

  const handleToggle = useCallback(
    async (provider: Provider, modelId: string, nextEnabled: boolean) => {
      const pendingId = `${provider}:${modelId}`;
      setPendingKey(pendingId);

      // Find model name for toast message
      const providerData = state.find((p) => p.provider === provider);
      const model = providerData?.models.find((m) => m.id === modelId);
      const modelName = model?.name ?? modelId;

      // optimistic update
      setState((prev) =>
        prev.map((p) =>
          p.provider === provider
            ? {
                ...p,
                models: p.models.map((m) =>
                  m.id === modelId ? { ...m, enabled: nextEnabled } : m
                ),
              }
            : p
        )
      );

      try {
        await updateModelPreference.mutateAsync({
          provider,
          model: modelId,
          enabled: nextEnabled,
        });
        toast.success(`${modelName} ${nextEnabled ? 'enabled' : 'disabled'}`);
      } catch (error) {
        // revert on error
        setState((prev) =>
          prev.map((p) =>
            p.provider === provider
              ? {
                  ...p,
                  models: p.models.map((m) =>
                    m.id === modelId ? { ...m, enabled: !nextEnabled } : m
                  ),
                }
              : p
          )
        );
        toast.error(String(error));
      } finally {
        setPendingKey(null);
      }
    },
    [state, updateModelPreference]
  );

  const providerCards = useMemo(
    () =>
      state.map((provider) => {
        const displayName =
          providerDisplayNames[
            provider.provider as keyof typeof providerDisplayNames
          ] ?? provider.provider;
        const logo = providerLogos[
          provider.provider as keyof typeof providerLogos
        ] ?? <Cpu className="size-6" />;

        const activeCount = provider.models.filter((m) => m.enabled).length;
        const totalCount = provider.models.length;
        const hasActiveModels = activeCount > 0;
        const isRequired = provider.provider === 'gemini';

        if (!provider.hasKey) {
          return (
            <div
              key={provider.provider}
              className={cn(
                'bg-card border-border/60 hover:bg-accent/50 flex min-h-[68px] items-center justify-between rounded-lg border p-4 text-sm transition-colors',
                isRequired &&
                  'border-destructive/50 ring-destructive/20 shadow-sm ring-1'
              )}
            >
              <div className="flex items-center gap-3">
                {logo}
                <div className="flex items-center gap-2 font-medium">
                  {displayName}
                  {isRequired && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-bold tracking-wider uppercase"
                    >
                      Required
                    </Badge>
                  )}
                  {provider.provider === 'gemini' ? (
                    <Badge
                      variant="secondary"
                      className="border-emerald-200 bg-emerald-100 text-[10px] font-bold tracking-wider text-emerald-700 uppercase dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                    >
                      Free Tier
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="border-purple-200 bg-purple-100 text-[10px] font-bold tracking-wider text-purple-700 uppercase dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                    >
                      Paid Credits
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAddApiKey(provider.provider)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add API Key
              </Button>
            </div>
          );
        }

        return (
          <Collapsible
            key={provider.provider}
            className="bg-card border-border/60 rounded-lg border transition-colors"
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="hover:bg-accent/50 flex min-h-[68px] w-full items-center justify-between p-4 text-left transition-colors"
              >
                <span className="flex items-center gap-3">
                  {logo}
                  <div className="flex items-center gap-2 font-medium">
                    {displayName}
                    {isRequired && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-bold tracking-wider uppercase"
                      >
                        Required
                      </Badge>
                    )}
                    {provider.provider === 'gemini' ? (
                      <Badge
                        variant="secondary"
                        className="border-emerald-200 bg-emerald-100 text-[10px] font-bold tracking-wider text-emerald-700 uppercase dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                      >
                        Free Tier
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="border-purple-200 bg-purple-100 text-[10px] font-bold tracking-wider text-purple-700 uppercase dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                      >
                        Paid Credits
                      </Badge>
                    )}
                  </div>
                </span>
                <span
                  className={`flex items-center gap-2 text-sm ${
                    hasActiveModels ? 'text-green-600' : 'text-muted-foreground'
                  }`}
                >
                  {activeCount} of {totalCount} active
                  <ChevronDown className="h-4 w-4" />
                </span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 px-4 pb-4">
              {provider.models.length > 0 ? (
                provider.models.map((model) => {
                  const toggleId = `${provider.provider}:${model.id}`;
                  const disabled =
                    updateModelPreference.isPending && pendingKey === toggleId;
                  return (
                    <div
                      key={model.id}
                      className="hover:bg-muted flex items-center justify-between rounded-md px-2 py-0.5"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm leading-none font-medium">
                          {model.name}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {model.id}
                        </p>
                      </div>
                      <Switch
                        checked={model.enabled}
                        onCheckedChange={(checked) =>
                          handleToggle(provider.provider, model.id, checked)
                        }
                        disabled={disabled}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="text-muted-foreground py-2 text-center text-sm">
                  No models available for this provider.
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      }),
    [
      state,
      updateModelPreference.isPending,
      pendingKey,
      handleToggle,
      handleAddApiKey,
    ]
  );

  if (!hasProviders) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm font-medium">No providers available</p>
        <p className="text-muted-foreground text-sm">
          Something went wrong. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {providerCards}
      {selectedProvider && (
        <ApiKeyDialog
          provider={selectedProvider}
          open={isApiKeyDialogOpen}
          onOpenChange={setIsApiKeyDialogOpen}
          onSuccess={handleApiKeySuccess}
          hasKey={false}
        />
      )}
    </div>
  );
}
