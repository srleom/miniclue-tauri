import { createFileRoute, Link } from '@tanstack/react-router';
import { convertFileSrc } from '@tauri-apps/api/core';
import { FileText, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChatPanel } from '@/components/document/chat-panel';
import DocumentHeader from '@/components/document/document-header';
import PdfViewer from '@/components/document/pdf-viewer';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { SlideNavigationContext } from '@/lib/slide-navigation-context';
import { getDocumentPdfPath } from '@/lib/tauri';
import { useDocument, useFolder } from '../../hooks/use-queries';

export const Route = createFileRoute('/_app/document/$documentId')({
  component: DocumentPage,
});

function DocumentPdfContent({
  documentId,
  currentPage,
  onPageChange,
  onDocumentLoad,
  onFullscreenChange,
}: {
  documentId: string;
  currentPage: number;
  onPageChange: (page: number) => void;
  onDocumentLoad: (totalPages: number) => void;
  onFullscreenChange: (isFullscreen: boolean) => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

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
          onPageChange={onPageChange}
          onDocumentLoad={onDocumentLoad}
          onFullscreenChange={onFullscreenChange}
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  // External navigation: set page and signal PDF viewer to scroll there.
  // We use a ref so PdfViewer can distinguish external navigation from scroll events.
  const externalNavigateRef = useRef(false);
  const navigateToPage = useCallback((page: number) => {
    externalNavigateRef.current = true;
    setCurrentPage(page);
  }, []);

  // Stable callback for scroll-driven page changes from PdfViewer.
  // Memoized so PdfViewer doesn't re-register scroll listeners on every render.
  const handlePageChange = useCallback((page: number) => {
    if (!externalNavigateRef.current) {
      setCurrentPage(page);
    }
    externalNavigateRef.current = false;
  }, []);

  // Memoize context value to prevent unnecessary re-renders of all context consumers
  // (SlideMentionInput, SlideLink) on every scroll or streaming update.
  const slideNavContextValue = useMemo(
    () => ({ currentPage, totalPages, navigateToPage }),
    [currentPage, totalPages, navigateToPage]
  );

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SlideNavigationContext.Provider value={slideNavContextValue}>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center border-b">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
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
        </div>

        {/* Main Content: PDF + Right Panel */}
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={isFullscreen ? 100 : 50} minSize={30}>
              <DocumentPdfContent
                key={documentId}
                documentId={documentId}
                currentPage={currentPage}
                onPageChange={handlePageChange}
                onDocumentLoad={setTotalPages}
                onFullscreenChange={setIsFullscreen}
              />
            </ResizablePanel>
            {!isFullscreen && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={30}>
                  <ChatPanel documentId={documentId} status={document.status} />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
    </SlideNavigationContext.Provider>
  );
}
