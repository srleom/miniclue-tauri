import { BreadcrumbPage } from '@/components/ui/breadcrumb';
import { RenameDialog } from '@/components/common/rename-dialog';
import { RenameForm } from '@/components/common/rename-form';
import { Pencil } from 'lucide-react';
import { useUpdateDocument } from '@/hooks/use-queries';

export interface DocumentHeaderProps {
  documentId: string;
  documentTitle: string;
}

export default function DocumentHeader({
  documentId,
  documentTitle,
}: DocumentHeaderProps) {
  const updateDocument = useUpdateDocument();

  const handleUpdateDocument = async (id: string, title: string) => {
    try {
      await updateDocument.mutateAsync({ documentId: id, data: { title } });
      return { data: undefined };
    } catch {
      return { error: 'Failed to update document' };
    }
  };

  return (
    <div className="group inline-flex items-center gap-1">
      <BreadcrumbPage>{documentTitle}</BreadcrumbPage>
      <div className="flex items-center gap-1">
        <RenameDialog
          trigger={
            <button
              type="button"
              className="text-muted-foreground ml-1 opacity-100 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
              <Pencil size={12} />
            </button>
          }
          title="Rename document"
          form={
            <RenameForm
              id={documentId}
              defaultValue={documentTitle}
              action={handleUpdateDocument}
              successMessage="Document renamed"
            />
          }
        />
      </div>
    </div>
  );
}
