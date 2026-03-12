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
import type { Provider } from '@/lib/types';
import { providerDisplayNames } from './provider-constants';

// ---------------------------------------------------------------------------
// Delete API Key Dialog
// ---------------------------------------------------------------------------

interface DeleteApiKeyDialogProps {
  open: boolean;
  provider: Provider | null;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteApiKeyDialog({
  open,
  provider,
  isPending,
  onConfirm,
  onClose,
}: DeleteApiKeyDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete API Key</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete your{' '}
            {provider ? providerDisplayNames[provider] : ''} API key? This
            action cannot be undone and you will need to add a new key to use
            this provider again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isPending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Delete Custom Provider Dialog
// ---------------------------------------------------------------------------

interface DeleteCustomProviderDialogProps {
  open: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteCustomProviderDialog({
  open,
  isPending,
  onConfirm,
  onClose,
}: DeleteCustomProviderDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
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
          <AlertDialogCancel onClick={onClose} disabled={isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isPending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
