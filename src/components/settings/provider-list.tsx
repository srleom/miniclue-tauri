'use client';

// react
import type React from 'react';
import { useState } from 'react';

// icons
import { Check, X, ChevronRight, Trash2 } from 'lucide-react';

// third-party
import { toast } from 'sonner';

// components
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { ApiKeyDialog } from './api-key-dialog';

// actions
import { useDeleteApiKey } from '@/hooks/use-queries';
import type { Provider } from '@/lib/types';
import { providerDisplayNames, providers } from './provider-constants';
import { cn } from '@/lib/utils';

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
    </>
  );
}
