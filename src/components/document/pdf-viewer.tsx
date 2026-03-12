import {
  ChevronDownIcon,
  Loader2,
  Maximize2,
  Minimize2,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { debounce } from '@/lib/utils';

// Import required stylesheets for text selection and annotations (links)
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker using Vite's ?url import for proper bundling
// Note: pdfjs-dist is a dependency of react-pdf, so this imports the correct matching version
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

// Memoized PDF Page component to prevent unnecessary re-renders
const MemoizedPage = memo(
  ({
    pageNumber,
    scale,
    onLoadSuccess,
  }: {
    pageNumber: number;
    scale: number;
    onLoadSuccess?: (page: { width: number; height: number }) => void;
  }) => (
    <Page
      pageNumber={pageNumber}
      scale={scale}
      renderTextLayer={true}
      renderAnnotationLayer={true}
      className="shadow-lg"
      onLoadSuccess={onLoadSuccess}
      loading={
        <div className="flex items-center justify-center bg-background p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    />
  ),
  (prevProps, nextProps) => {
    // Custom comparison: only re-render if pageNumber or scale changed meaningfully
    // For scale, we consider changes less than 0.5% as insignificant to reduce re-renders
    const scaleChanged =
      Math.abs(nextProps.scale - prevProps.scale) / prevProps.scale > 0.005;
    return (
      prevProps.pageNumber === nextProps.pageNumber &&
      !scaleChanged &&
      prevProps.onLoadSuccess === nextProps.onLoadSuccess
    );
  }
);
MemoizedPage.displayName = 'MemoizedPage';

interface PdfViewerProps {
  /** URL or path to the PDF file */
  fileUrl: string;
  /** Current page number (1-indexed) */
  pageNumber: number;
  /** Callback when page changes */
  onPageChange: (page: number) => void;
  /** Callback when document finishes loading */
  onDocumentLoad: (totalPages: number) => void;
  /** Callback when fullscreen mode changes */
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /** Optional: Custom class name for container */
  className?: string;
}

export default function PdfViewer({
  fileUrl,
  pageNumber,
  onPageChange,
  onDocumentLoad,
  onFullscreenChange,
  className = '',
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState<number | 'fit'>('fit');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitToWidthScale, setFitToWidthScale] = useState(1.0);
  const [pdfPageWidth, setPdfPageWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef(pageNumber);
  const previousFileUrlRef = useRef(fileUrl);
  // Track the last pageNumber prop value we received so we can detect external changes
  const prevPageNumberPropRef = useRef(pageNumber);

  // Reset PDF-specific state when fileUrl changes (render-phase update)
  if (previousFileUrlRef.current !== fileUrl) {
    previousFileUrlRef.current = fileUrl;
    setPdfPageWidth(null);
    setFitToWidthScale(1.0);
    setNumPages(null);
    setScale('fit'); // Reset zoom to fit mode
  }

  // Update ref when pageNumber prop changes
  useEffect(() => {
    currentPageRef.current = pageNumber;
  }, [pageNumber]);

  // Scroll to page when pageNumber prop changes externally (e.g. citation click)
  useEffect(() => {
    if (!containerRef.current || !numPages) return;
    // Skip if this is the initial render or the page hasn't actually changed
    if (prevPageNumberPropRef.current === pageNumber) return;
    prevPageNumberPropRef.current = pageNumber;

    const pageEl = containerRef.current.querySelector(
      `[data-page-number="${pageNumber}"]`
    );
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [pageNumber, numPages]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: nextNumPages }: { numPages: number }) => {
      setNumPages(nextNumPages);
      onDocumentLoad(nextNumPages);
    },
    [onDocumentLoad]
  );

  const handleZoomIn = useCallback(() => {
    if (scale === 'fit') {
      // Switch from fit to fixed scale and increment
      setScale(Math.min(fitToWidthScale + 0.1, 3.0));
    } else {
      setScale((prevScale) => Math.min((prevScale as number) + 0.1, 3.0));
    }
  }, [scale, fitToWidthScale]);

  const handleZoomOut = useCallback(() => {
    if (scale === 'fit') {
      // Switch from fit to fixed scale and decrement
      setScale(Math.max(fitToWidthScale - 0.1, 0.5));
    } else {
      setScale((prevScale) => Math.max((prevScale as number) - 0.1, 0.5));
    }
  }, [scale, fitToWidthScale]);

  const handleZoomChange = useCallback((newScale: number | 'fit') => {
    setScale(newScale);
  }, []);

  const handleFullscreenToggle = useCallback(() => {
    const newFullscreenState = !isFullscreen;
    setIsFullscreen(newFullscreenState);
    onFullscreenChange?.(newFullscreenState);
  }, [isFullscreen, onFullscreenChange]);

  // Calculate fit-to-width scale
  const calculateFitToWidthScale = useCallback(() => {
    if (!containerRef.current || !pdfPageWidth) return;

    const containerWidth = containerRef.current.clientWidth;
    // Account for padding in the Document component (p-2 = 8px on each side)
    const availableWidth = containerWidth - 16;
    const calculatedScale = availableWidth / pdfPageWidth;

    // Apply reasonable constraints
    const constrainedScale = Math.max(0.3, Math.min(calculatedScale, 3.0));

    // Early return: only update if scale changed by more than 1% to avoid unnecessary re-renders
    setFitToWidthScale((prevScale) => {
      const percentChange = Math.abs(constrainedScale - prevScale) / prevScale;
      if (percentChange < 0.01) {
        return prevScale; // Skip update if change is insignificant
      }
      return constrainedScale;
    });
  }, [pdfPageWidth]);

  // Handle first page load to get PDF page dimensions
  const handlePageLoadSuccess = useCallback(
    (page: { width: number; height: number }) => {
      if (!pdfPageWidth) {
        // Store the first page width for fit-to-width calculations
        setPdfPageWidth(page.width);
      }
    },
    [pdfPageWidth]
  );

  // Recalculate fit-to-width when container resizes
  useEffect(() => {
    if (scale !== 'fit' || !containerRef.current) return;

    // Debounce resize calculations to avoid rapid-fire updates during sidebar animations
    // 250ms delay allows sidebar transition (200ms) to complete before recalculating
    const debouncedCalculate = debounce(calculateFitToWidthScale, 250);

    const observer = new ResizeObserver(() => {
      debouncedCalculate();
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [scale, calculateFitToWidthScale]);

  // Calculate fit-to-width when pdfPageWidth is set
  useEffect(() => {
    if (pdfPageWidth && scale === 'fit') {
      calculateFitToWidthScale();
    }
  }, [pdfPageWidth, scale, calculateFitToWidthScale]);

  // Track current page based on scroll position using Intersection Observer
  useEffect(() => {
    if (!containerRef.current || !numPages) return;

    const container = containerRef.current;

    // Function to manually check all pages and find the current one based on center position
    const updateCurrentPage = () => {
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      // Calculate the vertical center point of the viewport
      const containerCenter = containerRect.top + containerRect.height / 2;

      // Check if scrolled to top or bottom boundaries
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const SCROLL_THRESHOLD = 5; // pixels - allows for sub-pixel rendering and momentum scrolling
      const isAtTop = scrollTop <= SCROLL_THRESHOLD;
      const isAtBottom =
        scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD;

      // Get all page wrapper elements
      const pageElements = container.querySelectorAll('[data-page-number]');

      let currentPage = currentPageRef.current; // Fallback to previous page if no match

      // Special case: if scrolled to the very top, show first page
      if (isAtTop) {
        currentPage = 1;
      }
      // Special case: if scrolled to the very bottom, show last page
      else if (isAtBottom && numPages) {
        currentPage = numPages;
      }
      // Normal case: find page containing the center point
      else {
        pageElements.forEach((element) => {
          const pageNum = parseInt(
            element.getAttribute('data-page-number') || '0',
            10
          );
          if (pageNum === 0) return;

          const rect = element.getBoundingClientRect();

          // Check if the container's center point is within this page's bounds
          if (rect.top <= containerCenter && rect.bottom >= containerCenter) {
            currentPage = pageNum;
          }
        });
      }

      // Only update if the page actually changed
      if (currentPage !== currentPageRef.current) {
        currentPageRef.current = currentPage;
        prevPageNumberPropRef.current = currentPage; // Prevent scrollIntoView feedback loop
        onPageChange(currentPage);
      }
    };

    const options = {
      root: container,
      rootMargin: '0px',
      threshold: 0.1, // Trigger when at least 10% of the page is visible
    };

    // Use IntersectionObserver to trigger updates when any page visibility changes
    // Debounce to avoid excessive calls when multiple pages animate in/out during streaming
    const debouncedUpdateCurrentPage = debounce(updateCurrentPage, 50);
    const observer = new IntersectionObserver(() => {
      debouncedUpdateCurrentPage();
    }, options);

    // Observe all page elements
    const pageElements = container.querySelectorAll('[data-page-number]');
    pageElements.forEach((element) => {
      observer.observe(element);
    });

    // Also listen to scroll events for reliable updates
    // This ensures updates happen even when no pages enter/exit the viewport
    // Debounce to avoid firing on every pixel of scroll during streaming re-renders
    const handleScroll = debounce(() => {
      updateCurrentPage();
    }, 50);
    container.addEventListener('scroll', handleScroll);

    // Also run on initial mount
    updateCurrentPage();

    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [numPages, onPageChange]);

  return (
    <div className={`flex h-full w-full flex-col ${className}`}>
      {/* Toolbar */}
      <div className="flex h-12 w-full shrink-0 items-center justify-between border-b border-border px-4">
        {/* Page Navigation - Left */}
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-sm font-medium">
            {pageNumber} / {numPages || '—'}
          </span>
        </div>

        {/* Zoom Controls - Center */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomOut}
            disabled={scale !== 'fit' && (scale as number) <= 0.5}
            className="h-8 px-3"
            aria-label="Zoom out"
          >
            <ZoomOutIcon className="h-4 w-4" strokeWidth={1.5} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-3">
                {scale === 'fit'
                  ? 'Fit'
                  : `${Math.round((scale as number) * 100)}%`}
                <ChevronDownIcon className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem onClick={() => handleZoomChange('fit')}>
                Page Fit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleZoomChange(0.5)}>
                50%
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleZoomChange(0.75)}>
                75%
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleZoomChange(1.0)}>
                100%
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleZoomChange(1.25)}>
                125%
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleZoomChange(1.5)}>
                150%
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleZoomChange(2.0)}>
                200%
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleZoomChange(3.0)}>
                300%
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomIn}
            disabled={scale !== 'fit' && (scale as number) >= 3.0}
            className="h-8 px-3"
            aria-label="Zoom in"
          >
            <ZoomInIcon className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </div>

        {/* Fullscreen - Right */}
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFullscreenToggle}
            className="h-8 -mr-2 has-[>svg]:px-2"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
            )}
          </Button>
        </div>
      </div>

      {/* PDF Document */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-muted/20">
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
          error={
            <div className="flex h-full items-center justify-center">
              <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
                Failed to load PDF file.
              </div>
            </div>
          }
          className="flex flex-col gap-2 px-2 pt-2 pb-2"
        >
          {numPages &&
            Array.from(new Array(numPages), (_, index) => (
              <div
                key={`page_${index + 1}`}
                data-page-number={index + 1}
                className="flex justify-center"
              >
                <MemoizedPage
                  pageNumber={index + 1}
                  scale={scale === 'fit' ? fitToWidthScale : scale}
                  onLoadSuccess={
                    index === 0 ? handlePageLoadSuccess : undefined
                  }
                />
              </div>
            ))}
        </Document>
      </div>
    </div>
  );
}
