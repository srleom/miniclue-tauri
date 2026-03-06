import { Cpu, Key } from 'lucide-react';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import type { Provider } from '@/lib/types';
import { useModels } from '../../hooks/use-queries';
import { APIKeyHeader } from './api-key-header';
import { ModelsHeader } from './models-header';
import { ModelsList } from './models-list';
import { providers } from './provider-constants';
// Import existing components
import { ProviderListWrapper } from './provider-list-wrapper';

const navItems = [
  { name: 'API Keys', icon: Key, value: 'api-keys' },
  { name: 'Models', icon: Cpu, value: 'models' },
] as const;

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export function SettingsDialog({
  open,
  onOpenChange,
  children,
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] = React.useState<
    'api-keys' | 'models'
  >('api-keys');

  const { data: modelsData, error: modelsError } = useModels();

  // Error handling
  if (modelsError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {children}
        <DialogContent className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[800px] lg:max-w-[900px]">
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Manage your API keys and model preferences.
          </DialogDescription>
          <div className="flex flex-col items-center justify-center space-y-4 p-8">
            <p className="text-muted-foreground">Failed to load settings</p>
            <p className="text-destructive text-sm">{String(modelsError)}</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Prepare API keys status from modelsData
  const providersWithKeys = modelsData?.providers?.map((p) => p.provider) ?? [];
  const apiKeysStatus: Record<Provider, boolean> = {
    gemini: providersWithKeys.includes('gemini'),
    openai: providersWithKeys.includes('openai'),
    anthropic: providersWithKeys.includes('anthropic'),
    xai: providersWithKeys.includes('xai'),
    deepseek: providersWithKeys.includes('deepseek'),
  };

  // Prepare providers with models — custom providers use string keys starting with "custom:"
  const providersWithModels =
    modelsData?.providers?.map((p) => {
      const models =
        p.models
          ?.map((m) => ({
            id: m.id ?? '',
            name: m.name ?? m.id ?? '',
            enabled: Boolean(m.enabled),
          }))
          .filter((m) => m.id !== '') ?? [];
      return { provider: p.provider, models };
    }) ?? [];

  // Standard providers (non-custom)
  const providersData: {
    provider: string;
    models: { id: string; name: string; enabled: boolean }[];
    hasKey: boolean;
  }[] = providers.map((p) => {
    const providerModels = providersWithModels.find(
      (pm) => pm.provider === p.id
    );
    return {
      provider: p.id as string,
      models: providerModels?.models ?? [],
      hasKey: apiKeysStatus[p.id] ?? false,
    };
  });

  // Custom providers from modelsData
  const customProviderData = providersWithModels
    .filter((pm) => pm.provider.startsWith('custom:'))
    .map((pm) => ({
      provider: pm.provider,
      models: pm.models,
      hasKey: true,
    }));

  const allProvidersData = [...providersData, ...customProviderData];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
      <DialogContent className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[800px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your API keys and model preferences.
        </DialogDescription>

        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          asChild
                          isActive={activeSection === item.value}
                          onClick={() => setActiveSection(item.value)}
                        >
                          <button type="button">
                            <item.icon />
                            <span>{item.name}</span>
                          </button>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          <main className="flex h-[600px] flex-1 flex-col overflow-hidden py-8 px-6">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
              {activeSection === 'api-keys' && (
                <div>
                  <APIKeyHeader />
                  <div className="mt-8">
                    <h2 className="text-muted-foreground mb-4 text-sm font-medium tracking-tighter uppercase">
                      Provider Keys
                    </h2>
                    <ProviderListWrapper initialStatus={apiKeysStatus} />
                  </div>
                </div>
              )}

              {activeSection === 'models' && (
                <div>
                  <ModelsHeader />
                  <div className="mt-8">
                    <h2 className="text-muted-foreground mb-4 text-sm font-medium tracking-tighter uppercase">
                      Available Models
                    </h2>
                    <ModelsList providers={allProvidersData} />
                  </div>
                </div>
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
