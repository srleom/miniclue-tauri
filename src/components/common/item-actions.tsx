import type * as React from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2, FolderOpen } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import DeleteDialog from './delete-dialog';
import { RenameDialog } from './rename-dialog';
import { RenameForm } from './rename-form';
import { useMoveDocument } from '@/hooks/use-queries';

type Item = {
  id: string;
  title: string;
};

type ActionResponse<T> = {
  data?: T;
  error?: string;
};

interface ItemActionsProps<T> {
  item: Item;
  itemType: 'folder' | 'document';
  renameAction: (id: string, title: string) => Promise<ActionResponse<T>>;
  deleteAction: (id: string) => Promise<ActionResponse<void>>;
  children: React.ReactNode;
  isDefault?: boolean;
  dropdownMenuContentProps?: React.ComponentProps<typeof DropdownMenuContent>;
  onDeleteSuccess?: () => void;
  // For document move functionality
  currentFolderId?: string;
  availableFolders?: Array<{ folderId: string; title: string }>;
}

export function ItemActions<T>({
  item,
  itemType,
  renameAction,
  deleteAction,
  children,
  isDefault = false,
  dropdownMenuContentProps,
  onDeleteSuccess,
  currentFolderId,
  availableFolders = [],
}: ItemActionsProps<T>) {
  const [openMenu, setOpenMenu] = useState(false);
  const moveDocument = useMoveDocument();

  // Show all folders but identify the current one for disabling
  const moveTargetFolders = availableFolders
    .map((folder) => {
      const folderId = String(folder.folderId || '');
      const currentId = String(currentFolderId || '');
      return {
        ...folder,
        isCurrentFolder: folderId === currentId,
      };
    })
    .sort((a, b) => {
      // Sort current folder to the top
      if (a.isCurrentFolder && !b.isCurrentFolder) return -1;
      if (!a.isCurrentFolder && b.isCurrentFolder) return 1;
      return 0;
    });

  const handleMoveDocument = async (
    targetFolderId: string,
    targetFolderTitle: string
  ) => {
    // Validate inputs
    if (!targetFolderId || targetFolderId.trim() === '') {
      toast.error('Invalid target folder');
      return;
    }

    if (!item.id || item.id.trim() === '') {
      toast.error('Invalid document');
      return;
    }

    const toastId = toast.loading(
      `Moving document to "${targetFolderTitle}"...`
    );
    try {
      await moveDocument.mutateAsync({
        documentId: item.id,
        folderId: targetFolderId,
      });
      toast.success(`Document moved to "${targetFolderTitle}"`);
    } catch {
      toast.error('Failed to move document');
    } finally {
      toast.dismiss(toastId);
      setOpenMenu(false);
    }
  };

  return (
    <DropdownMenu open={openMenu} onOpenChange={setOpenMenu}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent {...dropdownMenuContentProps}>
        <RenameDialog
          onOpenChange={(open: boolean) => !open && setOpenMenu(false)}
          trigger={
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
            >
              <Pencil className="text-muted-foreground" />
              <span>Rename {itemType}</span>
            </DropdownMenuItem>
          }
          title={`Rename ${itemType}`}
          form={
            <RenameForm
              id={item.id}
              defaultValue={item.title}
              action={renameAction}
              successMessage={`${
                itemType.charAt(0).toUpperCase() + itemType.slice(1)
              } renamed`}
              onSuccess={() => {
                setOpenMenu(false);
              }}
            />
          }
        />

        {/* Move to Folder option - only for documents */}
        {itemType === 'document' && moveTargetFolders.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                onSelect={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
              >
                <FolderOpen className="text-muted-foreground mr-2 h-4 w-4" />
                <span>Move to</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {moveTargetFolders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.folderId}
                    className={`${
                      folder.isCurrentFolder
                        ? 'text-muted-foreground cursor-not-allowed opacity-50'
                        : ''
                    }`}
                    onSelect={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!folder.isCurrentFolder) {
                        handleMoveDocument(folder.folderId, folder.title);
                      }
                    }}
                    disabled={folder.isCurrentFolder}
                  >
                    {folder.title}
                    {folder.isCurrentFolder && ' (Current)'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {!isDefault && (
          <>
            <DropdownMenuSeparator />
            <DeleteDialog
              onOpenChange={(open: boolean) => !open && setOpenMenu(false)}
              title={`Are you sure you want to delete this ${itemType}?`}
              description="This action cannot be undone."
              onConfirm={async () => {
                const toastId = toast.loading(`Deleting ${itemType}...`);
                try {
                  const result = await deleteAction(item.id);
                  if (result?.error) {
                    toast.error(result.error as string);
                  } else {
                    onDeleteSuccess?.();
                  }
                } finally {
                  toast.dismiss(toastId);
                  setOpenMenu(false);
                }
              }}
            >
              <DropdownMenuItem
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                onSelect={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
              >
                <Trash2 className="text-destructive" />
                <span>Delete {itemType}</span>
              </DropdownMenuItem>
            </DeleteDialog>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
