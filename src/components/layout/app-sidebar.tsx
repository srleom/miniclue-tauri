import * as React from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Sparkle } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { NavPrimary } from './nav-primary';
import { NavFolders } from './nav-folders';
import { NavRecents } from './nav-recents';
import { NavSecondary } from './nav-secondary';
import {
  useFoldersWithDocuments,
  useRecentDocuments,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
  useUpdateDocument,
  useDeleteDocument,
} from '../../hooks/use-queries';

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: foldersData } = useFoldersWithDocuments();
  const { data: recentsData } = useRecentDocuments(10);

  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const updateDocument = useUpdateDocument();
  const deleteDocument = useDeleteDocument();

  // Check if currently viewing a folder or document page
  const currentFolderId = location.pathname.startsWith('/folder/')
    ? location.pathname.split('/')[2]
    : undefined;

  const currentDocumentId = location.pathname.startsWith('/document/')
    ? location.pathname.split('/')[2]
    : undefined;

  // Transform folders data to match expected format
  const foldersWithDocuments = React.useMemo(() => {
    if (!foldersData) return [];

    return foldersData.map((folder) => ({
      folderId: folder.id,
      title: folder.title,
      isDefault: folder.is_default,
      documents:
        folder.documents?.map((document) => ({
          document_id: document.id,
          title: document.title,
        })) || [],
      isActive: location.pathname.startsWith(`/folder/${folder.id}`),
    }));
  }, [foldersData, location.pathname]);

  // Transform recents data
  const recentsItems = React.useMemo(() => {
    if (!recentsData?.documents) return [];

    return recentsData.documents.map((document) => ({
      documentId: document.document_id,
      name: document.title,
      folderId: document.folder_id || '',
      url: `/document/${document.document_id}`,
    }));
  }, [recentsData]);

  // Available folders for move functionality
  const availableFolders = React.useMemo(() => {
    return foldersWithDocuments.map((folder) => ({
      folderId: folder.folderId,
      title: folder.title || 'Untitled',
    }));
  }, [foldersWithDocuments]);

  // Action handlers
  const handleCreateUntitledFolder = async () => {
    try {
      const result = await createFolder.mutateAsync({
        title: 'Untitled Folder',
      });
      return {
        data: {
          id: result.id,
          title: result.title,
          is_default: result.is_default,
        },
      };
    } catch {
      return { error: 'Failed to create folder' };
    }
  };

  const handleRenameFolder = async (folderId: string, title: string) => {
    try {
      await updateFolder.mutateAsync({ folderId, data: { title } });
      return { data: undefined };
    } catch {
      return { error: 'Failed to rename folder' };
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await deleteFolder.mutateAsync(folderId);

      // If we just deleted the folder we're viewing, redirect to home
      if (currentFolderId === folderId) {
        navigate({ to: '/' });
      }

      return { data: undefined };
    } catch {
      return { error: 'Failed to delete folder' };
    }
  };

  const handleUpdateDocumentAccessedAt = async (_documentId: string) => {
    // This would update accessed_at timestamp - can be a no-op for now
    return { data: undefined };
  };

  const handleUpdateDocument = async (documentId: string, title: string) => {
    try {
      await updateDocument.mutateAsync({ documentId, data: { title } });
      return { data: undefined };
    } catch {
      return { error: 'Failed to update document' };
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      // Find the folder that contains this document
      const folderWithDoc = foldersWithDocuments.find((folder) =>
        folder.documents.some((doc) => doc.document_id === documentId)
      );

      await deleteDocument.mutateAsync(documentId);

      // If we just deleted the document we're viewing, redirect to parent folder
      if (currentDocumentId === documentId && folderWithDoc) {
        navigate({
          to: '/folder/$folderId',
          params: { folderId: folderWithDoc.folderId },
        });
      }

      return { data: undefined };
    } catch {
      return { error: 'Failed to delete document' };
    }
  };

  return (
    <Sidebar variant="sidebar" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="hover:bg-transparent hover:text-inherit active:bg-transparent active:text-inherit"
            >
              <div className="flex items-center gap-2">
                <Link
                  to="/"
                  className="bg-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md"
                >
                  <Sparkle className="text-primary-foreground size-4" />
                </Link>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <NavPrimary />
        <NavFolders
          items={foldersWithDocuments}
          createUntitledFolder={handleCreateUntitledFolder}
          deleteFolder={handleDeleteFolder}
          renameFolder={handleRenameFolder}
          handleUpdateDocumentAccessedAt={handleUpdateDocumentAccessedAt}
          updateDocument={handleUpdateDocument}
          deleteDocument={handleDeleteDocument}
          availableFolders={availableFolders}
        />
        {recentsItems.length > 0 && (
          <NavRecents
            items={recentsItems}
            handleUpdateDocumentAccessedAt={handleUpdateDocumentAccessedAt}
            updateDocument={handleUpdateDocument}
            deleteDocument={handleDeleteDocument}
            availableFolders={availableFolders}
          />
        )}
      </SidebarContent>

      <SidebarFooter className="p-0">
        <NavSecondary />
      </SidebarFooter>
    </Sidebar>
  );
}
