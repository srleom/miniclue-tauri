import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useDocument, useFolder } from '../../hooks/use-queries';
import { FileText, Loader2 } from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import PdfViewer from '@/components/document/pdf-viewer';
import { getDocumentPdfPath } from '@/lib/tauri';
import { convertFileSrc } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import DocumentHeader from '@/components/document/document-header';

export const Route = createFileRoute('/_app/document/$documentId')({
  component: DocumentPage,
});

function DocumentPdfContent({ documentId }: { documentId: string }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [_totalPages, setTotalPages] = useState(0);
  const [_isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const loadPdf = async () => {
      try {
        const path = await getDocumentPdfPath(documentId);
        const assetUrl = convertFileSrc(path);
        setPdfUrl(assetUrl);
      } catch (error) {
        console.error('Failed to load PDF:', error);
        toast.error('Failed to load PDF');
      }
    };

    loadPdf();
  }, [documentId]);

  return (
    <div className="h-full w-full overflow-hidden">
      {pdfUrl ? (
        <PdfViewer
          key={documentId}
          fileUrl={pdfUrl}
          pageNumber={currentPage}
          onPageChange={setCurrentPage}
          onDocumentLoad={setTotalPages}
          onFullscreenChange={setIsFullscreen}
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-gray-100 dark:bg-gray-900">
          <div className="text-center text-muted-foreground">
            <FileText className="mx-auto h-12 w-12" />
            <p className="mt-4">Loading PDF...</p>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentPage() {
  const { documentId } = Route.useParams();
  const { data: document } = useDocument(documentId);
  const { data: folder } = useFolder(document?.folder_id ?? '');

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isProcessing =
    document.status === 'parsing' ||
    document.status === 'processing' ||
    document.status === 'pending_processing';

  const getStatusBadgeClass = (status: string) => {
    if (status === 'complete') return 'bg-green-100 text-green-700';
    if (status === 'failed') return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1 hover:cursor-pointer" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <Breadcrumb>
            <BreadcrumbList>
              {document.folder_id && folder && (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Link
                        to="/folder/$folderId"
                        params={{ folderId: document.folder_id }}
                      >
                        {folder.title}
                      </Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </>
              )}
              <BreadcrumbItem>
                <DocumentHeader
                  documentId={documentId}
                  documentTitle={document.title}
                />
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-2 px-4">
          {isProcessing && (
            <div className="flex items-center gap-2 text-sm text-yellow-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </div>
          )}
          <span
            className={`rounded-full px-3 py-1 text-sm ${getStatusBadgeClass(
              document.status
            )}`}
          >
            {document.status}
          </span>
        </div>
      </div>

      {/* Main Content: PDF + Right Panel */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50} minSize={30}>
            <DocumentPdfContent key={documentId} documentId={documentId} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center text-muted-foreground">
                <p className="text-lg">Coming soon…</p>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
