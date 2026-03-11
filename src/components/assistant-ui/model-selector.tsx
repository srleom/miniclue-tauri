import { useQuery } from '@tanstack/react-query';
import { Sparkle } from 'lucide-react';
import { Fragment } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { listModels } from '@/lib/tauri';
import { cn } from '@/lib/utils';

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  local: 'On Device',
};

function getProviderDisplayName(providerKey: string): string {
  if (providerKey.startsWith('custom:')) return 'Custom';
  return PROVIDER_DISPLAY_NAMES[providerKey] ?? providerKey;
}

interface ModelSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

/**
 * Model selector dropdown that fetches available models from backend
 * and groups them by provider (OpenAI, Anthropic, Google, xAI, DeepSeek)
 */
export function ModelSelector({
  value,
  onValueChange,
  className,
}: ModelSelectorProps) {
  const { data: modelsData, isLoading } = useQuery({
    queryKey: ['models'],
    queryFn: listModels,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Filter to only show enabled models
  const enabledProviders =
    modelsData?.providers
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((model) => model.enabled),
      }))
      .filter((provider) => provider.models.length > 0) || [];

  if (isLoading) {
    return (
      <Select disabled>
        <SelectTrigger className={className}>
          <SelectValue placeholder="Loading models..." />
        </SelectTrigger>
      </Select>
    );
  }

  if (enabledProviders.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger className={className}>
          <SelectValue placeholder="No models available" />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(className, 'flex items-center gap-2')}>
        <Sparkle className="size-3" strokeWidth={2.5} />
        <SelectValue placeholder="Select a model" />
      </SelectTrigger>
      <SelectContent side="top">
        {enabledProviders.map((provider, index) => (
          <Fragment key={provider.provider}>
            <SelectGroup key={provider.provider}>
              <SelectLabel>
                {getProviderDisplayName(provider.provider)}
              </SelectLabel>
              {provider.models.map((model) => (
                <SelectItem key={model.id} value={model.id} className="text-xs">
                  {model.name}
                </SelectItem>
              ))}
            </SelectGroup>
            {index < enabledProviders.length - 1 ? <SelectSeparator /> : null}
          </Fragment>
        ))}
      </SelectContent>
    </Select>
  );
}
