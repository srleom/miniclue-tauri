import { Check, ChevronRight, Cpu, Plus, Trash2, X } from 'lucide-react';
import type React from 'react';
import {
  providerDisplayNames,
  providerLogos,
} from '@/components/settings/provider-constants';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import type { CustomProviderResponse, Provider } from '@/lib/types';
import { ApiKeyInlineForm } from './api-key-inline-form';
import { ProviderBadge } from './provider-badge';

export type ProviderModels = {
  provider: string;
  models: { id: string; name: string; enabled: boolean }[];
  hasKey: boolean;
};

interface ProviderCardProps {
  provider: ProviderModels;
  isEditingKey: boolean;
  editingKeyHasKey: boolean;
  pendingKey: string | null;
  updateModelPreferencePending: boolean;
  deleteApiKeyPending: boolean;
  deleteCustomProviderPending: boolean;
  customProviders: CustomProviderResponse[];
  onAddApiKey: (provider: Provider) => void;
  onEditApiKey: (provider: Provider) => void;
  onApiKeySuccess: () => void;
  onApiKeyCancel: () => void;
  onDeleteKeyClick: (provider: Provider, e: React.MouseEvent) => void;
  onEditCustomProvider: (cp: CustomProviderResponse) => void;
  onDeleteCustomClick: (id: string, e: React.MouseEvent) => void;
  onToggle: (provider: string, modelId: string, nextEnabled: boolean) => void;
}

export function ProviderCard({
  provider,
  isEditingKey,
  editingKeyHasKey,
  pendingKey,
  updateModelPreferencePending,
  deleteApiKeyPending,
  deleteCustomProviderPending,
  customProviders,
  onAddApiKey,
  onEditApiKey,
  onApiKeySuccess,
  onApiKeyCancel,
  onDeleteKeyClick,
  onEditCustomProvider,
  onDeleteCustomClick,
  onToggle,
}: ProviderCardProps) {
  const isCustom = provider.provider.startsWith('custom:');

  const displayName =
    providerDisplayNames[
      provider.provider as keyof typeof providerDisplayNames
    ] ?? provider.provider.replace('custom:', '');

  const logo = providerLogos[
    provider.provider as keyof typeof providerLogos
  ] ?? <Cpu className="size-6" />;

  const activeCount = provider.models.filter((m) => m.enabled).length;
  const totalCount = provider.models.length;
  const hasActiveModels = activeCount > 0;

  const typeBadge = isCustom ? (
    <ProviderBadge variant="custom" />
  ) : provider.provider === 'gemini' ? (
    <ProviderBadge variant="free-tier" />
  ) : (
    <ProviderBadge variant="paid" />
  );

  // No-key variant
  if (!provider.hasKey) {
    return (
      <div className="bg-card border-border/60 min-h-[68px] rounded-lg border p-4 text-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {logo}
            <div className="flex items-center gap-2 font-medium">
              {displayName}
              {typeBadge}
            </div>
          </div>
          {!isEditingKey && (
            <div className="flex items-center gap-2">
              <div className="text-muted-foreground flex items-center gap-1 text-sm">
                <X className="h-4 w-4" />
                <span>Not added</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAddApiKey(provider.provider as Provider)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add API Key
              </Button>
            </div>
          )}
        </div>

        {isEditingKey && (
          <ApiKeyInlineForm
            provider={provider.provider as Provider}
            hasKey={false}
            onSuccess={onApiKeySuccess}
            onCancel={onApiKeyCancel}
          />
        )}
      </div>
    );
  }

  // With-key variant (collapsible)
  const cpId = provider.provider.replace('custom:', '');
  const cp = isCustom ? customProviders.find((c) => c.id === cpId) : null;

  return (
    <Collapsible className="bg-card border-border/60 rounded-lg border transition-colors">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="group hover:bg-accent/50 flex min-h-[68px] w-full items-center justify-between p-4 text-left transition-colors rounded-b-none rounded-t-lg"
        >
          <span className="flex items-center gap-3">
            {logo}
            <div className="flex items-center gap-2 font-medium">
              {displayName}
              {typeBadge}
            </div>
          </span>
          <span
            className={`flex items-center gap-2 text-sm ${
              hasActiveModels ? 'text-green-600' : 'text-muted-foreground'
            }`}
          >
            {isCustom ? (
              <ProviderBadge variant="always-active" />
            ) : (
              <>
                <Check className="h-4 w-4 text-green-600" />
                {activeCount} of {totalCount} active
              </>
            )}
            <ChevronRight className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-90" />
          </span>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 px-4 py-4">
        {provider.models.length > 0 ? (
          provider.models.map((model) => {
            const toggleId = `${provider.provider}:${model.id}`;
            const disabled =
              updateModelPreferencePending && pendingKey === toggleId;
            return (
              <div
                key={model.id}
                className="hover:bg-muted flex items-center justify-between rounded-md px-2 py-0.5"
              >
                <div className="space-y-0.5">
                  <p className="text-sm leading-none font-medium">
                    {model.name}
                  </p>
                  <p className="text-muted-foreground text-xs">{model.id}</p>
                </div>
                {isCustom ? (
                  <ProviderBadge variant="always-active" />
                ) : (
                  <Switch
                    checked={model.enabled}
                    onCheckedChange={(checked) =>
                      onToggle(provider.provider, model.id, checked)
                    }
                    disabled={disabled}
                  />
                )}
              </div>
            );
          })
        ) : (
          <div className="text-muted-foreground py-2 text-center text-sm">
            No models available for this provider.
          </div>
        )}

        {!isCustom &&
          (isEditingKey ? (
            <ApiKeyInlineForm
              provider={provider.provider as Provider}
              hasKey={editingKeyHasKey}
              onSuccess={onApiKeySuccess}
              onCancel={onApiKeyCancel}
            />
          ) : (
            <div className="border-border/40 mt-2 flex items-center justify-end gap-2 border-t pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEditApiKey(provider.provider as Provider)}
                className="gap-1 text-xs"
              >
                Edit API Key
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) =>
                  onDeleteKeyClick(provider.provider as Provider, e)
                }
                className="text-destructive hover:text-destructive gap-1 text-xs"
                disabled={deleteApiKeyPending}
              >
                <Trash2 className="h-3 w-3" />
                Delete Key
              </Button>
            </div>
          ))}

        {isCustom && cp && (
          <div className="border-border/40 mt-2 flex items-center justify-end gap-2 border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEditCustomProvider(cp)}
              className="gap-1 text-xs"
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => onDeleteCustomClick(cp.id, e)}
              className="text-destructive hover:text-destructive gap-1 text-xs"
              disabled={deleteCustomProviderPending}
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
