import { createFileRoute } from '@tanstack/react-router';
import { useFoldersWithDocuments } from '../../hooks/use-queries';
import { Badge } from '@/components/ui/badge';
import { PdfUpload } from '@/components/upload/pdf-upload';
import { SidebarTrigger } from '@/components/ui/sidebar';

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});

function HomePage() {
  const { data: folders, error } = useFoldersWithDocuments();

  if (error) {
    console.error('Failed to load folders:', error);
  }

  const defaultFolder = folders?.find((f) => f.is_default);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
        </div>
      </header>
      <div className="mx-auto flex w-full flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
        <div className="mx-auto mt-16 flex w-full flex-col items-center lg:w-3xl">
          <Badge
            variant="secondary"
            className="flex items-center gap-2 font-mono text-xs font-medium"
          >
            <span className="relative flex size-2">
              <span className="bg-chart-2 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"></span>
              <span className="bg-chart-2 relative inline-flex size-2 rounded-full"></span>
            </span>
            ONLINE
          </Badge>

          <h1 className="mt-4 text-center text-4xl font-semibold">
            Ready when you are.
          </h1>
          <p className="text-muted-foreground mt-4 mb-10 max-w-md text-center">
            Upload your PDF documents to get started. <br />
          </p>
          <div className="w-full">
            <PdfUpload isFolderPage={true} folderId={defaultFolder?.id} />
          </div>
        </div>
      </div>
    </>
  );
}
