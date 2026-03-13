import { ArrowRight, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ApiKeyInlineForm } from '@/components/settings/api-key-inline-form';
import { providers } from '@/components/settings/provider-constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useModels } from '@/hooks/use-queries';
import type { Provider } from '@/lib/types';

export interface ApiKeysStepProps {
  onFinish: () => void;
}

export function ApiKeysStep({ onFinish }: ApiKeysStepProps) {
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const { data: modelsData } = useModels();
  const existingKeys = new Set(
    modelsData?.providers?.map((p) => p.provider) ?? []
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h2 className="text-3xl font-medium tracking-tight">Add an API key</h2>
        <p className="text-muted-foreground text-sm">
          Connect a cloud AI provider for more model options.
        </p>
      </div>

      {/* Provider cards */}
      <div className="space-y-2">
        {providers.map((provider) => {
          const hasKey = existingKeys.has(provider.id);
          const isActive = activeProvider === provider.id;

          return (
            <div key={provider.id} className="rounded-lg border bg-card">
              <button
                type="button"
                onClick={() => setActiveProvider(isActive ? null : provider.id)}
                className="flex items-center w-full px-4 py-3.5 text-left hover:bg-accent/50 transition-colors rounded-b-none rounded-t-lg"
              >
                <span className="flex items-center gap-4 flex-1">
                  <span className="text-foreground/70 size-5 shrink-0">
                    {provider.logo}
                  </span>
                  <span className="font-medium">{provider.name}</span>
                  {hasKey && (
                    <Badge
                      variant="secondary"
                      className="text-xs bg-green-100 text-green-700 font-medium"
                    >
                      Connected
                    </Badge>
                  )}
                </span>

                <ChevronRight
                  className={`text-muted-foreground size-4 transition-transform duration-200 ${
                    isActive ? 'rotate-90' : ''
                  }`}
                />
              </button>

              {isActive && (
                <div className="px-4 pb-4">
                  <ApiKeyInlineForm
                    provider={provider.id}
                    hasKey={hasKey}
                    onSuccess={() => {
                      setActiveProvider(null);
                    }}
                    onCancel={() => setActiveProvider(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1">
        <Button size="lg" className="w-full" onClick={onFinish}>
          Continue to MiniClue
          <ArrowRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          className="w-full text-muted-foreground hover:text-foreground hover:bg-transparent"
          onClick={onFinish}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}
