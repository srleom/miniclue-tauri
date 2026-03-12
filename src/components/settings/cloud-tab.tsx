import { Plus } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  useCustomProviders,
  useDeleteApiKey,
  useDeleteCustomProvider,
  useUpdateModelPreference,
} from '@/hooks/use-queries';
import type { CustomProviderResponse, Provider } from '@/lib/types';
import { CustomProviderDialog } from './custom-provider-dialog';
import { CustomProviderCard } from './custom-provider-card';
import {
  DeleteApiKeyDialog,
  DeleteCustomProviderDialog,
} from './delete-dialogs';
import { ProviderCard, type ProviderModels } from './provider-card';

export type { ProviderModels };

type CloudTabProps = {
  providers: ProviderModels[];
};

export function CloudTab({ providers }: CloudTabProps) {
  const [state, setState] = useState<ProviderModels[]>(providers);
  const updateModelPreference = useUpdateModelPreference();
  const deleteApiKey = useDeleteApiKey();
  const deleteCustomProvider = useDeleteCustomProvider();
  const { data: customProviders = [] } = useCustomProviders();

  useEffect(() => {
    setState(providers);
  }, [providers]);

  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // Inline API key form state
  const [editingKeyProvider, setEditingKeyProvider] = useState<string | null>(
    null
  );
  const [editingKeyHasKey, setEditingKeyHasKey] = useState(false);

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

  const handleAddApiKey = useCallback((provider: Provider) => {
    setEditingKeyProvider(provider);
    setEditingKeyHasKey(false);
  }, []);

  const handleEditApiKey = useCallback((provider: Provider) => {
    setEditingKeyProvider(provider);
    setEditingKeyHasKey(true);
  }, []);

  const handleApiKeySuccess = useCallback(() => {
    setEditingKeyProvider(null);
    setEditingKeyHasKey(false);
  }, []);

  const handleApiKeyCancel = useCallback(() => {
    setEditingKeyProvider(null);
    setEditingKeyHasKey(false);
  }, []);

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
      toast.success(`${deleteProvider} API key deleted successfully`);
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

  const standaloneCustomProviders = customProviders.filter(
    (cp) => !state.some((p) => p.provider === `custom:${cp.id}`)
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Cloud</h1>
        <p className="text-muted-foreground mt-2">
          Manage API keys and enable the models you want available in chat.
        </p>
      </div>

      <div className="mt-8 space-y-3">
        {state.map((provider) => (
          <ProviderCard
            key={provider.provider}
            provider={provider}
            isEditingKey={editingKeyProvider === provider.provider}
            editingKeyHasKey={editingKeyHasKey}
            pendingKey={pendingKey}
            updateModelPreferencePending={updateModelPreference.isPending}
            deleteApiKeyPending={deleteApiKey.isPending}
            deleteCustomProviderPending={deleteCustomProvider.isPending}
            customProviders={customProviders}
            onAddApiKey={handleAddApiKey}
            onEditApiKey={handleEditApiKey}
            onApiKeySuccess={handleApiKeySuccess}
            onApiKeyCancel={handleApiKeyCancel}
            onDeleteKeyClick={handleDeleteKeyClick}
            onEditCustomProvider={handleEditCustomProvider}
            onDeleteCustomClick={handleDeleteCustomClick}
            onToggle={handleToggle}
          />
        ))}

        {standaloneCustomProviders.map((cp) => (
          <CustomProviderCard
            key={cp.id}
            cp={cp}
            deleteCustomProviderPending={deleteCustomProvider.isPending}
            onEdit={handleEditCustomProvider}
            onDelete={handleDeleteCustomClick}
          />
        ))}

        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleAddCustomProvider}
        >
          <Plus className="h-4 w-4" />
          Add Custom Provider
        </Button>
      </div>

      <CustomProviderDialog
        open={isCustomDialogOpen}
        onOpenChange={setIsCustomDialogOpen}
        existing={editingCustomProvider ?? undefined}
      />

      <DeleteApiKeyDialog
        open={isDeleteKeyDialogOpen}
        provider={deleteProvider}
        isPending={deleteApiKey.isPending}
        onConfirm={handleDeleteKeyConfirm}
        onClose={() => {
          setIsDeleteKeyDialogOpen(false);
          setDeleteProvider(null);
        }}
      />

      <DeleteCustomProviderDialog
        open={isDeleteCustomDialogOpen}
        isPending={deleteCustomProvider.isPending}
        onConfirm={handleDeleteCustomConfirm}
        onClose={() => {
          setIsDeleteCustomDialogOpen(false);
          setDeleteCustomId(null);
        }}
      />
    </>
  );
}
