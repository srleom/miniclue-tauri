import type { ColumnDef } from '@tanstack/react-table';
import { Link, useNavigate, useLocation } from '@tanstack/react-router';
import { MoreHorizontal } from 'lucide-react';
import { ItemActions } from '@/components/common/item-actions';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { useUpdateDocument, useDeleteDocument } from '@/hooks/use-queries';
import type { Document } from '@/lib/types';

interface ColumnsProps {
  currentFolderId: string;
  availableFolders: Array<{ folderId: string; title: string }>;
}

export const createColumns = ({
  currentFolderId,
  availableFolders,
}: ColumnsProps): ColumnDef<Document>[] => [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: (info) => (
      <Link
        to="/document/$documentId"
        params={{ documentId: info.row.original.id }}
        className="block h-full w-full"
      >
        {info.getValue<string>()}
      </Link>
    ),
    size: 350,
  },
  {
    accessorKey: 'created_at',
    header: 'Created At',
    cell: (info) => {
      const raw = info.row.original.created_at;
      return (
        <Link
          to="/document/$documentId"
          params={{ documentId: info.row.original.id }}
          className="block h-full w-full"
        >
          {formatDate(raw)}
        </Link>
      );
    },
    size: 200,
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const document = row.original;
      return (
        <ActionsCell
          document={document}
          currentFolderId={currentFolderId}
          availableFolders={availableFolders}
        />
      );
    },
    size: 50,
  },
];

// Separate component for actions to use hooks
function ActionsCell({
  document,
  currentFolderId,
  availableFolders,
}: {
  document: Document;
  currentFolderId: string;
  availableFolders: Array<{ folderId: string; title: string }>;
}) {
  const updateDocument = useUpdateDocument();
  const deleteDocument = useDeleteDocument();
  const navigate = useNavigate();
  const location = useLocation();

  // Check if currently viewing this document
  const currentDocumentId = location.pathname.startsWith('/document/')
    ? location.pathname.split('/')[2]
    : undefined;

  const handleUpdateDocument = async (id: string, title: string) => {
    try {
      await updateDocument.mutateAsync({ documentId: id, data: { title } });
      return { data: undefined };
    } catch {
      return { error: 'Failed to update document' };
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await deleteDocument.mutateAsync(id);

      // If we just deleted the document we're viewing, redirect to parent folder
      if (currentDocumentId === id) {
        navigate({
          to: '/folder/$folderId',
          params: { folderId: currentFolderId },
        });
      }

      return { data: undefined };
    } catch {
      return { error: 'Failed to delete document' };
    }
  };

  return (
    <div className="flex justify-end">
      <ItemActions
        item={{ id: document.id, title: document.title }}
        itemType="document"
        renameAction={handleUpdateDocument}
        deleteAction={handleDeleteDocument}
        dropdownMenuContentProps={{ align: 'end' }}
        currentFolderId={currentFolderId}
        availableFolders={availableFolders}
      >
        <Button variant="ghost" className="h-8 w-8 p-0">
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </ItemActions>
    </div>
  );
}
