'use client';

// icons
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Plus,
  Server,
  Trash2,
  X,
} from 'lucide-react';
// react
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
// third-party
import { toast } from 'sonner';
import { ApiKeyDialog } from '@/components/settings/api-key-dialog';
// code
import {
  providerDisplayNames,
  providerLogos,
} from '@/components/settings/provider-constants';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
// components
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import {
  useCustomProviders,
  useDeleteApiKey,
  useDeleteCustomProvider,
  useUpdateModelPreference,
} from '@/hooks/use-queries';
import type { CustomProviderResponse, Provider } from '@/lib/types';
import { CustomProviderDialog } from './custom-provider-dialog';

type ProviderModels = {
  provider: string;
  models: { id: string; name: string; enabled: boolean }[];
  hasKey: boolean;
};

type ModelsListProps = {
  providers: ProviderModels[];
};

export function ModelsList({ providers }: ModelsListProps) {
  const [state, setState] = useState<ProviderModels[]>(providers);
  const updateModelPreference = useUpdateModelPreference();
  const deleteApiKey = useDeleteApiKey();
  const deleteCustomProvider = useDeleteCustomProvider();
  const { data: customProviders = [] } = useCustomProviders();

  useEffect(() => {
    setState(providers);
  }, [providers]);

  // Model toggle state
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // API key dialog state
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(
    null
  );
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [apiKeyDialogHasKey, setApiKeyDialogHasKey] = useState(false);

  // Delete API key dialog state
  const [deleteProvider, setDeleteProvider] = useState<Provider | null>(null);
  const [isDeleteKeyDialogOpen, setIsDeleteKeyDialogOpen] = useState(false);

  // Custom provider dialog state
  const [isCustomDialogOpen, setIsCustomDialogOpen] = useState(false);
  const [editingCustomProvider, setEditingCustomProvider] =
    useState<CustomProviderResponse | null>(null);

  // Delete custom provider dialog state
  const [deleteCustomId, setDeleteCustomId] = useState<string | null>(null);
  const [isDeleteCustomDialogOpen, setIsDeleteCustomDialogOpen] =
    useState(false);

  // --- Handlers ---

  const handleAddApiKey = useCallback((provider: Provider) => {
    setSelectedProvider(provider);
    setApiKeyDialogHasKey(false);
    setIsApiKeyDialogOpen(true);
  }, []);

  const handleEditApiKey = useCallback((provider: Provider) => {
    setSelectedProvider(provider);
    setApiKeyDialogHasKey(true);
    setIsApiKeyDialogOpen(true);
  }, []);

  const handleApiKeySuccess = () => {
    setIsApiKeyDialogOpen(false);
    setSelectedProvider(null);
    toast.success('API key saved!');
  };

  const handleDeleteKeyClick = useCallback(
    (provider: Provider, e: React.MouseEvent) => {
      e.stopPropagation();
      setDeleteProvider(provider);
      setIsDeleteKeyDialogOpen(true);
    },
    []
  );

  const handleDeleteKeyConfirm = async () => {
    if (!deleteProvider) return;
    try {
      await deleteApiKey.mutateAsync(deleteProvider);
      toast.success(
        `${providerDisplayNames[deleteProvider]} API key deleted successfully`
      );
      setIsDeleteKeyDialogOpen(false);
      setDeleteProvider(null);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleAddCustomProvider = () => {
    setEditingCustomProvider(null);
    setIsCustomDialogOpen(true);
  };

  const handleEditCustomProvider = useCallback((cp: CustomProviderResponse) => {
    setEditingCustomProvider(cp);
    setIsCustomDialogOpen(true);
  }, []);

  const handleDeleteCustomClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setDeleteCustomId(id);
      setIsDeleteCustomDialogOpen(true);
    },
    []
  );

  const handleDeleteCustomConfirm = async () => {
    if (!deleteCustomId) return;
    try {
      await deleteCustomProvider.mutateAsync(deleteCustomId);
      toast.success('Custom provider deleted');
      setIsDeleteCustomDialogOpen(false);
      setDeleteCustomId(null);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleToggle = useCallback(
    async (provider: string, modelId: string, nextEnabled: boolean) => {
      const pendingId = `${provider}:${modelId}`;
      setPendingKey(pendingId);

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
          provider: provider as Provider,
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
        const isCustom = provider.provider.startsWith('custom:');

        const displayName = isCustom
          ? (providerDisplayNames[
              provider.provider as keyof typeof providerDisplayNames
            ] ?? provider.provider.replace('custom:', ''))
          : (providerDisplayNames[
              provider.provider as keyof typeof providerDisplayNames
            ] ?? provider.provider);
        const logo = providerLogos[
          provider.provider as keyof typeof providerLogos
        ] ?? <Cpu className="size-6" />;

        const activeCount = provider.models.filter((m) => m.enabled).length;
        const totalCount = provider.models.length;
        const hasActiveModels = activeCount > 0;

        // Providers without a key: show Add API Key button
        if (!provider.hasKey) {
          return (
            <div
              key={provider.provider}
              className="bg-card border-border/60 hover:bg-accent/50 flex min-h-[68px] items-center justify-between rounded-lg border p-4 text-sm transition-colors"
            >
              <div className="flex items-center gap-3">
                {logo}
                <div className="flex items-center gap-2 font-medium">
                  {displayName}
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
              <div className="flex items-center gap-2">
                <div className="text-muted-foreground flex items-center gap-1 text-sm">
                  <X className="h-4 w-4" />
                  <span>Not added</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddApiKey(provider.provider as Provider)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add API Key
                </Button>
              </div>
            </div>
          );
        }

        // Providers with a key: collapsible model list + edit/delete key actions
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
                    {isCustom ? (
                      <Badge
                        variant="secondary"
                        className="border-blue-200 bg-blue-100 text-[10px] font-bold tracking-wider text-blue-700 uppercase dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                      >
                        Custom
                      </Badge>
                    ) : provider.provider === 'gemini' ? (
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
                  {isCustom ? (
                    <Badge
                      variant="secondary"
                      className="border-green-200 bg-green-100 text-[10px] font-bold tracking-wider text-green-700 uppercase dark:border-green-800 dark:bg-green-900/30 dark:text-green-400"
                    >
                      Always active
                    </Badge>
                  ) : (
                    <>
                      <Check className="h-4 w-4 text-green-600" />
                      {activeCount} of {totalCount} active
                    </>
                  )}
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
                      {isCustom ? (
                        <Badge
                          variant="secondary"
                          className="border-green-200 bg-green-100 text-[10px] font-bold tracking-wider text-green-700 uppercase dark:border-green-800 dark:bg-green-900/30 dark:text-green-400"
                        >
                          Always active
                        </Badge>
                      ) : (
                        <Switch
                          checked={model.enabled}
                          onCheckedChange={(checked) =>
                            handleToggle(provider.provider, model.id, checked)
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

              {/* API key actions in expanded panel */}
              {!isCustom && (
                <div className="border-border/40 mt-2 flex items-center justify-end gap-2 border-t pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleEditApiKey(provider.provider as Provider)
                    }
                    className="gap-1 text-xs"
                  >
                    Edit API Key
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) =>
                      handleDeleteKeyClick(provider.provider as Provider, e)
                    }
                    className="text-destructive hover:text-destructive gap-1 text-xs"
                    disabled={deleteApiKey.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete Key
                  </Button>
                </div>
              )}

              {/* Custom provider edit/delete actions */}
              {isCustom &&
                (() => {
                  const cpId = provider.provider.replace('custom:', '');
                  const cp = customProviders.find((c) => c.id === cpId);
                  if (!cp) return null;
                  return (
                    <div className="border-border/40 mt-2 flex items-center justify-end gap-2 border-t pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditCustomProvider(cp)}
                        className="gap-1 text-xs"
                      >
                        Edit
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDeleteCustomClick(cp.id, e)}
                        className="text-destructive hover:text-destructive gap-1 text-xs"
                        disabled={deleteCustomProvider.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </Button>
                    </div>
                  );
                })()}
            </CollapsibleContent>
          </Collapsible>
        );
      }),
    [
      state,
      customProviders,
      updateModelPreference.isPending,
      deleteApiKey.isPending,
      deleteCustomProvider.isPending,
      pendingKey,
      handleToggle,
      handleAddApiKey,
      handleEditApiKey,
      handleEditCustomProvider,
      handleDeleteKeyClick,
      handleDeleteCustomClick,
    ]
  );

  return (
    <>
      <div className="space-y-3">
        {providerCards}

        {/* Custom providers not yet in the modelsData list */}
        {customProviders
          .filter((cp) => !state.some((p) => p.provider === `custom:${cp.id}`))
          .map((cp) => (
            <div
              key={cp.id}
              className="bg-card hover:bg-accent/50 flex min-h-[68px] items-center justify-between rounded-lg border p-4 text-sm transition-colors"
            >
              <div className="flex items-center gap-3">
                <Server className="size-6" />
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {cp.name}
                    <Badge
                      variant="secondary"
                      className="border-blue-200 bg-blue-100 text-[10px] font-bold tracking-wider text-blue-700 uppercase dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                    >
                      Custom
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">{cp.base_url}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  <span>Active</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditCustomProvider(cp)}
                  className="gap-1 text-xs"
                >
                  Edit
                  <ChevronRight className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => handleDeleteCustomClick(cp.id, e)}
                  className="text-destructive hover:text-destructive"
                  disabled={deleteCustomProvider.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

        {/* Add custom provider */}
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleAddCustomProvider}
        >
          <Plus className="h-4 w-4" />
          Add Custom Provider
        </Button>
      </div>

      {/* API key dialog */}
      {selectedProvider && (
        <ApiKeyDialog
          provider={selectedProvider}
          open={isApiKeyDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsApiKeyDialogOpen(false);
              setSelectedProvider(null);
            } else {
              setIsApiKeyDialogOpen(true);
            }
          }}
          onSuccess={handleApiKeySuccess}
          hasKey={apiKeyDialogHasKey}
        />
      )}

      {/* Custom provider dialog */}
      <CustomProviderDialog
        open={isCustomDialogOpen}
        onOpenChange={setIsCustomDialogOpen}
        existing={editingCustomProvider ?? undefined}
      />

      {/* Delete API key confirmation */}
      <AlertDialog
        open={isDeleteKeyDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDeleteKeyDialogOpen(false);
            setDeleteProvider(null);
          } else {
            setIsDeleteKeyDialogOpen(true);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete your{' '}
              {deleteProvider ? providerDisplayNames[deleteProvider] : ''} API
              key? This action cannot be undone and you will need to add a new
              key to use this provider again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setIsDeleteKeyDialogOpen(false);
                setDeleteProvider(null);
              }}
              disabled={deleteApiKey.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteKeyConfirm}
              disabled={deleteApiKey.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteApiKey.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete custom provider confirmation */}
      <AlertDialog
        open={isDeleteCustomDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDeleteCustomDialogOpen(false);
            setDeleteCustomId(null);
          } else {
            setIsDeleteCustomDialogOpen(true);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this custom provider? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setIsDeleteCustomDialogOpen(false);
                setDeleteCustomId(null);
              }}
              disabled={deleteCustomProvider.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCustomConfirm}
              disabled={deleteCustomProvider.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteCustomProvider.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
