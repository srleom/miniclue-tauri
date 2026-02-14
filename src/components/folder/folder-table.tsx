import { DataTable } from './data-table';
import { createColumns } from './columns';
import type { Document } from '@/lib/types';

interface FolderTableProps {
  data: Document[];
  currentFolderId: string;
  availableFolders: Array<{ folderId: string; title: string }>;
}

export function FolderTable({
  data,
  currentFolderId,
  availableFolders,
}: FolderTableProps) {
  const columns = createColumns({ currentFolderId, availableFolders });

  return <DataTable columns={columns} data={data} />;
}
