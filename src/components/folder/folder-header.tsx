import { Folder, Pencil } from 'lucide-react';
import { RenameDialog } from '@/components/common/rename-dialog';
import { RenameForm } from '@/components/common/rename-form';
import { Badge } from '@/components/ui/badge';
import { useUpdateFolder } from '@/hooks/use-queries';

export interface FolderHeaderProps {
  folderId: string;
  folderTitle: string;
  isDefault: boolean;
}

export default function FolderHeader({
  folderId,
  folderTitle,
  isDefault,
}: FolderHeaderProps) {
  const updateFolder = useUpdateFolder();

  const handleUpdateFolder = async (id: string, title: string) => {
    try {
      await updateFolder.mutateAsync({ folderId: id, data: { title } });
      return { data: undefined };
    } catch {
      return { error: 'Failed to update folder' };
    }
  };

  return (
    <div className="group mb-7 flex items-center gap-2">
      <Folder />
      <h1 className="text-center text-4xl font-semibold">{folderTitle}</h1>
      {isDefault && <Badge variant="outline">Default</Badge>}
      {!isDefault && (
        <RenameDialog
          trigger={
            <button
              type="button"
              className="text-muted-foreground ml-2 opacity-100 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
              <Pencil size={20} />
            </button>
          }
          title="Rename folder"
          form={
            <RenameForm
              id={folderId}
              defaultValue={folderTitle}
              action={handleUpdateFolder}
              successMessage="Folder renamed"
            />
          }
        />
      )}
    </div>
  );
}
