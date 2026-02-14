import { createFileRoute, Link } from '@tanstack/react-router';
import {
  useFolder,
  useDocuments,
  useFoldersWithDocuments,
} from '../../hooks/use-queries';
import FolderHeader from '../../components/folder/folder-header';
import { FolderTable } from '../../components/folder/folder-table';
import { PdfUpload } from '../../components/upload/pdf-upload';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';

export const Route = createFileRoute('/_app/folder/$folderId')({
  component: FolderPage,
});

function FolderPage() {
  const { folderId } = Route.useParams();
  const { data: folder, error: folderError } = useFolder(folderId);
  const { data: documents } = useDocuments(folderId);
  const { data: allFolders, error: foldersError } = useFoldersWithDocuments();

  if (folderError) {
    console.error('Failed to load folder:', folderError);
  }

  if (foldersError) {
    console.error('Failed to load available folders:', foldersError);
  }

  const folderTitle = folder?.title ?? '';
  const isDefault = Boolean(folder?.is_default);
  const moveAvailableFolders = foldersError
    ? []
    : (allFolders ?? []).map((f) => ({ folderId: f.id, title: f.title }));

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1 hover:cursor-pointer" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/folder/$folderId" params={{ folderId }}>
                    {folderTitle}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Documents</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="mx-auto flex w-full flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
        <div className="mx-auto mt-16 flex w-full flex-col items-center lg:w-3xl">
          <FolderHeader
            folderId={folderId}
            folderTitle={folderTitle}
            isDefault={isDefault}
          />

          <div className="mb-12 w-full">
            <PdfUpload isFolderPage={true} folderId={folderId} />
          </div>
          <FolderTable
            data={documents ?? []}
            currentFolderId={folderId}
            availableFolders={moveAvailableFolders}
          />
        </div>
      </div>
    </>
  );
}
