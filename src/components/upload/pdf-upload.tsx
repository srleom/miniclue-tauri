import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { Upload as UploadIcon, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  FileUpload,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
} from '@/components/ui/file-upload';
import { importDocuments } from '@/lib/tauri';
import { cn } from '@/lib/utils';

function createFileFromPath(path: string): File {
  const fileName = path.split(/[\\/]/).pop() || path;
  return new File([], fileName, { type: 'application/pdf' });
}

interface PdfUploadProps {
  isFolderPage?: boolean;
  folderId?: string;
}

export function PdfUpload({ isFolderPage = false, folderId }: PdfUploadProps) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [filePaths, setFilePaths] = React.useState<string[]>([]);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Subscribe to Tauri's OS-level drag-drop events (HTML5 events don't fire
  // for OS file drops because Tauri intercepts them at the webview level)
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        const { type } = event.payload;

        if (type === 'enter') {
          setIsDragging(true);
        } else if (type === 'leave') {
          setIsDragging(false);
        } else if (type === 'drop') {
          setIsDragging(false);
          const paths = event.payload.paths.filter((p) =>
            p.toLowerCase().endsWith('.pdf')
          );
          if (paths.length === 0) {
            toast.error('Only PDF files are supported.');
            return;
          }
          setFilePaths((prev) => {
            const merged = [...prev, ...paths.filter((p) => !prev.includes(p))];
            setFiles(merged.map(createFileFromPath));
            return merged;
          });
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => unlisten?.();
  }, []);

  const openFileBrowser = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (selected && Array.isArray(selected)) {
      setFilePaths((prev) => {
        const merged = [...prev, ...selected.filter((p) => !prev.includes(p))];
        setFiles(merged.map(createFileFromPath));
        return merged;
      });
    }
  };

  const handleUpload = async () => {
    if (filePaths.length === 0) {
      toast.info('No files to upload.');
      return;
    }

    setIsUploading(true);
    const toastId = toast.loading(
      `Uploading ${filePaths.length} file${filePaths.length > 1 ? 's' : ''}...`
    );

    try {
      const documentIds = await importDocuments({
        file_paths: filePaths,
        folder_id: folderId ?? null,
      });

      toast.dismiss(toastId);
      toast.success(
        `Successfully started processing ${documentIds.length} document${documentIds.length > 1 ? 's' : ''}!`
      );

      queryClient.invalidateQueries({
        queryKey: ['folder', folderId, 'documents'],
      });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['recents'] });

      setFiles([]);
      setFilePaths([]);

      if (documentIds.length > 0) {
        navigate({
          to: '/document/$documentId',
          params: { documentId: documentIds[0] },
        });
      }
    } catch (error) {
      toast.dismiss(toastId);
      toast.error(`Failed to upload files: ${error}`);
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileDelete = (fileToRemove: File) => {
    const index = files.indexOf(fileToRemove);
    if (index !== -1) {
      setFiles((prev) => prev.filter((_, i) => i !== index));
      setFilePaths((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleValueChange = (newFiles: File[]) => {
    setFiles(newFiles);
    setFilePaths(newFiles.map((_f, i) => filePaths[i] ?? '').filter(Boolean));
  };

  const hasFiles = files.length > 0;

  return (
    <div className="grid w-full gap-3">
      <FileUpload
        accept="application/pdf,.pdf"
        value={files}
        onValueChange={handleValueChange}
      >
        {/* Dropzone — always visible */}
        <button
          type="button"
          aria-label="Upload PDF files"
          onClick={() => !isUploading && openFileBrowser()}
          disabled={isUploading}
          className={cn(
            'border-muted-foreground/20 flex min-h-[15em] w-full cursor-pointer select-none items-center justify-center rounded-xl border-2 border-dashed transition-colors disabled:pointer-events-none disabled:opacity-50 md:min-h-[18em]',
            isDragging
              ? 'border-primary/40 bg-primary/5'
              : 'hover:border-muted-foreground/35 hover:bg-muted/30'
          )}
        >
          <div className="pointer-events-none flex flex-col items-center gap-3 p-6 text-center">
            <div
              className={cn(
                'rounded-full border p-3 transition-colors',
                isDragging
                  ? 'border-primary/30 text-primary'
                  : 'border-muted-foreground/20 text-muted-foreground'
              )}
            >
              <UploadIcon className="h-6 w-6" />
            </div>
            <div>
              <p className="font-medium">
                {isFolderPage
                  ? 'Upload PDFs to this folder'
                  : 'Upload PDFs to Drafts folder'}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                {isDragging
                  ? 'Drop to add your files'
                  : 'Click to browse, or drag & drop a file here'}
              </p>
            </div>
          </div>
        </button>

        {/* File list */}
        {hasFiles && (
          <FileUploadList className="gap-2">
            {files.map((file, index) => (
              <FileUploadItem
                key={`${file.name}-${index}`}
                value={file}
                className="bg-muted/40 rounded-lg border px-3 py-2.5"
              >
                <FileUploadItemPreview className="text-muted-foreground" />
                <FileUploadItemMetadata>
                  <span className="truncate text-sm font-medium leading-none">
                    {file.name}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    PDF document
                  </span>
                </FileUploadItemMetadata>
                <FileUploadItemDelete asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground ml-auto h-7 w-7 shrink-0"
                    onClick={() => handleFileDelete(file)}
                    disabled={isUploading}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </FileUploadItemDelete>
              </FileUploadItem>
            ))}
          </FileUploadList>
        )}
      </FileUpload>

      {/* Upload button */}
      {isFolderPage && hasFiles && (
        <Button
          onClick={handleUpload}
          disabled={isUploading}
          className="w-full"
        >
          {isUploading
            ? 'Uploading...'
            : `Upload ${files.length} PDF${files.length > 1 ? 's' : ''}`}
        </Button>
      )}
    </div>
  );
}
