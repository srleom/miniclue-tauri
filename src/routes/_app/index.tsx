import { createFileRoute } from '@tanstack/react-router';
import { useFoldersWithDocuments } from '@/hooks/use-queries';
import { PdfUpload } from '@/components/upload/pdf-upload';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});

function HomePage() {
  const { data: folders, error, isLoading } = useFoldersWithDocuments();

  const defaultFolder = folders?.find((f) => f.is_default);

  const currentHour = new Date().getHours();
  const greeting =
    currentHour < 12
      ? 'Good Morning'
      : currentHour < 18
        ? 'Good Afternoon'
        : 'Good Evening';

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center -mt-25 justify-center p-4 pt-0">
        {isLoading ? (
          <div className="w-full max-w-2xl space-y-4">
            <Skeleton className="mx-auto h-10 w-56" />
            <Skeleton className="mx-auto h-4 w-72" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : error ? (
          <p className="text-destructive text-sm">
            Failed to load. Please restart the app.
          </p>
        ) : (
          <div className="w-full max-w-2xl">
            <div className="flex gap-2 justify-center items-center mb-8">
              <img src="/icon.svg" alt="Logo" className="size-10" />
              <h1 className="text-4xl font-medium tracking-tight">
                {greeting}
              </h1>
            </div>
            <PdfUpload isFolderPage={false} folderId={defaultFolder?.id} />
          </div>
        )}
      </div>
    </>
  );
}
