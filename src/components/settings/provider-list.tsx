'use client';

// icons
import { Check, ChevronRight, Plus, Server, Trash2, X } from 'lucide-react';
// react
import type React from 'react';
import { useState } from 'react';

// third-party
import { toast } from 'sonner';
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
// actions
import {
  useCustomProviders,
  useDeleteApiKey,
  useDeleteCustomProvider,
} from '@/hooks/use-queries';
import type { CustomProviderResponse, Provider } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ApiKeyDialog } from './api-key-dialog';
import { CustomProviderDialog } from './custom-provider-dialog';
import { providerDisplayNames, providers } from './provider-constants';

interface ProviderListProps {
  apiKeysStatus: Record<Provider, boolean>;
  onUpdate: (provider: Provider) => void;
}

export function ProviderList({ apiKeysStatus, onUpdate }: ProviderListProps) {
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(
    null
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteProvider, setDeleteProvider] = useState<Provider | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const deleteApiKey = useDeleteApiKey();

  // Custom provider state
  const { data: customProviders = [] } = useCustomProviders();
  const deleteCustomProvider = useDeleteCustomProvider();
  const [isCustomDialogOpen, setIsCustomDialogOpen] = useState(false);
  const [editingCustomProvider, setEditingCustomProvider] =
    useState<CustomProviderResponse | null>(null);
  const [deleteCustomId, setDeleteCustomId] = useState<string | null>(null);
  const [isDeleteCustomDialogOpen, setIsDeleteCustomDialogOpen] =
    useState(false);

  const handleProviderClick = (provider: Provider) => {
    setSelectedProvider(provider);
    setIsDialogOpen(true);
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setSelectedProvider(null);
  };

  const handleSuccess = () => {
    handleDialogClose();
    if (selectedProvider) {
      onUpdate(selectedProvider);
    }
  };

  const handleDeleteClick = (provider: Provider, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteProvider(provider);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteProvider) return;

    try {
      await deleteApiKey.mutateAsync(deleteProvider);
      toast.success(
        `${providerDisplayNames[deleteProvider]} API key deleted successfully`
      );
      onUpdate(deleteProvider);
      setIsDeleteDialogOpen(false);
      setDeleteProvider(null);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleDeleteCancel = () => {
    setIsDeleteDialogOpen(false);
    setDeleteProvider(null);
  };

  // Custom provider handlers
  const handleAddCustomProvider = () => {
    setEditingCustomProvider(null);
    setIsCustomDialogOpen(true);
  };

  const handleEditCustomProvider = (cp: CustomProviderResponse) => {
    setEditingCustomProvider(cp);
    setIsCustomDialogOpen(true);
  };

  const handleDeleteCustomClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteCustomId(id);
    setIsDeleteCustomDialogOpen(true);
  };

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

  const handleDeleteCustomCancel = () => {
    setIsDeleteCustomDialogOpen(false);
    setDeleteCustomId(null);
  };

  return (
    <>
      <div className="space-y-3">
        {providers.map((provider) => {
          const hasKey = apiKeysStatus[provider.id] ?? false;
          const isRequired = provider.id === 'gemini';

          return (
            <div
              key={provider.id}
              className={cn(
                'bg-card hover:bg-accent/50 flex min-h-[68px] items-center justify-between rounded-lg border p-4 text-sm transition-colors',
                isRequired &&
                  !hasKey &&
                  'border-destructive/50 ring-destructive/20 shadow-sm ring-1'
              )}
            >
              <div className="flex items-center gap-3">
                {provider.logo}
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {provider.name}
                    {isRequired && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-bold tracking-wider uppercase"
                      >
                        Required
                      </Badge>
                    )}
                    {provider.id === 'gemini' ? (
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
              </div>
              <div className="flex items-center gap-4">
                {hasKey ? (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <Check className="h-4 w-4" />
                    <span>Active</span>
                  </div>
                ) : (
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <X className="h-4 w-4" />
                    <span>Not added</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleProviderClick(provider.id)}
                    className="gap-2"
                  >
                    {hasKey ? 'Edit' : 'Add'}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  {hasKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleDeleteClick(provider.id, e)}
                      className="text-destructive hover:text-destructive"
                      disabled={deleteApiKey.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Custom providers section */}
        {customProviders.map((cp) => (
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
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="h-4 w-4" />
                <span>Active</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditCustomProvider(cp)}
                  className="gap-2"
                >
                  Edit
                  <ChevronRight className="h-4 w-4" />
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
          </div>
        ))}

        {/* Add custom provider button */}
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleAddCustomProvider}
        >
          <Plus className="h-4 w-4" />
          Add Custom Provider
        </Button>
      </div>

      {selectedProvider && (
        <ApiKeyDialog
          provider={selectedProvider}
          open={isDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleDialogClose();
            } else {
              setIsDialogOpen(true);
            }
          }}
          onSuccess={handleSuccess}
          hasKey={apiKeysStatus[selectedProvider] ?? false}
        />
      )}

      <CustomProviderDialog
        open={isCustomDialogOpen}
        onOpenChange={setIsCustomDialogOpen}
        existing={editingCustomProvider ?? undefined}
      />

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleDeleteCancel();
          } else {
            setIsDeleteDialogOpen(true);
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
              onClick={handleDeleteCancel}
              disabled={deleteApiKey.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteApiKey.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteApiKey.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isDeleteCustomDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleDeleteCustomCancel();
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
              onClick={handleDeleteCustomCancel}
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
