import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { open } from '@tauri-apps/plugin-dialog';
import { AlertCircle, Upload as UploadIcon, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  FileUpload,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from '@/components/ui/file-upload';
import { importDocuments } from '@/lib/tauri';

interface PdfUploadProps {
  isFolderPage?: boolean;
  folderId?: string;
}

export function PdfUpload({ isFolderPage = false, folderId }: PdfUploadProps) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [filePaths, setFilePaths] = React.useState<string[]>([]);
  const [isUploading, setIsUploading] = React.useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Create a lightweight File object from a path for display purposes
  const createFileFromPath = (path: string): File => {
    const fileName = path.split(/[\\/]/).pop() || path;
    // Create a mock File object - we don't have actual file data yet
    // The browser File constructor requires a Blob, so we use an empty one
    const file = new File([], fileName, { type: 'application/pdf' });
    return file;
  };

  const handleBrowseFiles = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault(); // Prevent FileUploadTrigger from opening browser file input

    const selected = await open({
      multiple: true,
      filters: [
        {
          name: 'PDF',
          extensions: ['pdf'],
        },
      ],
    });

    if (selected && Array.isArray(selected)) {
      // Create File objects for display
      const selectedFiles = selected.map(createFileFromPath);
      setFiles(selectedFiles);
      setFilePaths(selected);
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

      // Invalidate documents query to refresh the list
      queryClient.invalidateQueries({
        queryKey: ['folder', folderId, 'documents'],
      });
      queryClient.invalidateQueries({ queryKey: ['folders'] });

      // Invalidate recent documents (new uploads should appear in recents)
      queryClient.invalidateQueries({ queryKey: ['recents'] });

      setFiles([]);
      setFilePaths([]);

      // Navigate to the first lecture if only one was uploaded
      if (documentIds.length === 1) {
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

  const onUploadHandler = async (
    uploadFiles: File[],
    options: {
      onProgress: (file: File, progress: number) => void;
      onSuccess: (file: File) => void;
      onError: (file: File, error: Error) => void;
    }
  ) => {
    try {
      // Directly upload files without simulation
      await handleUpload();

      // Mark all files as successful
      uploadFiles.forEach((file) => {
        options.onSuccess(file);
      });
    } catch (error) {
      // Mark all files as failed
      uploadFiles.forEach((file) => {
        options.onError(
          file,
          error instanceof Error ? error : new Error('Upload failed')
        );
      });
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
    // When a file is removed via the DiceUI component
    setFiles(newFiles);
    // Keep filePaths in sync
    const newPaths = newFiles.map((_file, i) => filePaths[i] || '');
    setFilePaths(newPaths.filter(Boolean));
  };

  return (
    <div className="grid w-full gap-4">
      <FileUpload
        maxFiles={3}
        accept="application/pdf,.pdf"
        value={files}
        onValueChange={handleValueChange}
        onUpload={onUploadHandler}
      >
        {/* Browse button - replaces dropzone */}
        <div className="flex flex-col items-center gap-4">
          <div className="border-muted-foreground/25 flex min-h-[14em] w-full items-center justify-center rounded-lg border-2 border-dashed transition-colors md:min-h-[16em]">
            <div className="flex flex-col items-center gap-4 p-6 text-center">
              <UploadIcon className="h-10 w-10 text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold">
                  {isFolderPage
                    ? 'Upload documents here'
                    : 'Click to select PDF files'}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm">
                  You can upload up to 3 PDF files.
                </p>
              </div>
              <FileUploadTrigger asChild>
                <Button
                  onClick={handleBrowseFiles}
                  disabled={isUploading}
                  variant="outline"
                >
                  Browse files
                </Button>
              </FileUploadTrigger>
            </div>
          </div>
        </div>

        {/* File list */}
        <FileUploadList>
          {files.map((file, index) => (
            <FileUploadItem key={`${file.name}-${index}`} value={file}>
              <FileUploadItemPreview />
              <FileUploadItemMetadata>
                <div className="flex flex-col gap-1">
                  <span className="truncate font-medium text-sm">
                    {file.name}
                  </span>
                </div>
              </FileUploadItemMetadata>
              <FileUploadItemDelete asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleFileDelete(file)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </FileUploadItemDelete>
            </FileUploadItem>
          ))}
        </FileUploadList>
      </FileUpload>

      {/* Rate limit warning */}
      {files.length > 2 && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Rate Limit Warning</AlertTitle>
          <AlertDescription>
            If you&apos;re using the free tier of Gemini, uploading more than 2
            files at once might hit your API rate limits, causing document
            processing to fail. Proceed with caution.
          </AlertDescription>
        </Alert>
      )}

      {/* Upload button */}
      {isFolderPage && files.length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            disabled={isUploading}
            className="w-full sm:w-auto"
          >
            {isUploading
              ? 'Uploading...'
              : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      )}
    </div>
  );
}
