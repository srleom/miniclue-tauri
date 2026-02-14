import * as React from 'react';
import { toast } from 'sonner';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import NavDocument from './nav-document';
import { ChevronRight, Folder, MoreHorizontal, Plus } from 'lucide-react';
import { Link, useLocation } from '@tanstack/react-router';
import { ItemActions } from '@/components/common/item-actions';
import { cn } from '@/lib/utils';

type ActionResponse<T> = {
  data?: T;
  error?: string;
};

type FolderResponseDTO = {
  id: string;
  title: string;
  is_default: boolean;
};

export type FolderWithDocuments = {
  folderId: string;
  isDefault?: boolean;
  title?: string;
  documents: { document_id: string; title: string }[];
  isActive?: boolean;
};

export function NavFolders({
  items,
  createUntitledFolder,
  deleteFolder,
  renameFolder,
  handleUpdateDocumentAccessedAt,
  updateDocument,
  deleteDocument,
  availableFolders = [],
}: {
  items: FolderWithDocuments[];
  createUntitledFolder: () => Promise<ActionResponse<FolderResponseDTO>>;
  deleteFolder: (folderId: string) => Promise<ActionResponse<void>>;
  renameFolder: (
    folderId: string,
    title: string
  ) => Promise<ActionResponse<FolderResponseDTO>>;
  handleUpdateDocumentAccessedAt: (
    documentId: string
  ) => Promise<ActionResponse<void>>;
  updateDocument: (
    documentId: string,
    title: string
  ) => Promise<ActionResponse<unknown>>;
  deleteDocument: (documentId: string) => Promise<ActionResponse<void>>;
  availableFolders?: Array<{ folderId: string; title: string }>;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const location = useLocation();

  const handleNavigation = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const defaultFolder = items.find((item) => item.isDefault);
  const otherFolders = items.filter((item) => !item.isDefault);

  const sortedItems = defaultFolder ? [defaultFolder, ...otherFolders] : items;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="peer group/folders hover:bg-sidebar-accent relative flex w-full items-center justify-between pr-1">
        <span>Folders</span>
        <SidebarGroupAction
          className="hover:bg-sidebar-border absolute top-1.5 right-1 group-hover/folders:opacity-100 hover:cursor-pointer data-[state=open]:opacity-100 md:opacity-0"
          onClick={async () => {
            const result = await createUntitledFolder();
            if (result.error) {
              toast.error(result.error);
              return;
            }
            toast.success('Folder created');
          }}
        >
          <Plus />
          <span className="sr-only">Add folder</span>
        </SidebarGroupAction>
      </SidebarGroupLabel>
      <SidebarMenu className="max-h-64 overflow-x-hidden overflow-y-auto">
        {sortedItems.map((item) =>
          item.folderId && item.title ? (
            <SidebarMenuItem key={item.folderId}>
              <Collapsible defaultOpen={item.isActive}>
                <div className="group/collapsible relative flex items-center justify-between">
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      className={cn(
                        location.pathname === `/folder/${item.folderId}`
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground group'
                          : 'group',
                        item.isDefault && 'pr-2!' // Prevent pr-8 from group-has when nested docs have actions
                      )}
                    >
                      <ChevronRight className="block transition-transform group-hover/collapsible:block group-data-[state=open]:rotate-90 md:hidden" />
                      <Folder className="hidden group-hover/collapsible:hidden md:block" />
                      <Link
                        to="/folder/$folderId"
                        params={{ folderId: item.folderId }}
                        className="flex w-full items-center gap-2 truncate"
                        onClick={handleNavigation}
                      >
                        <span className="truncate">{item.title}</span>
                        {item.isDefault && (
                          <Badge
                            variant="outline"
                            className="ml-auto shrink-0 px-1.5 py-0 text-[10px]"
                          >
                            Default
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  {!item.isDefault && (
                    <ItemActions
                      item={{ id: item.folderId, title: item.title }}
                      itemType="folder"
                      renameAction={renameFolder}
                      deleteAction={deleteFolder}
                      isDefault={item.isDefault}
                      dropdownMenuContentProps={{
                        className: 'w-48 rounded-lg',
                        side: isMobile ? 'bottom' : 'right',
                        align: isMobile ? 'end' : 'start',
                      }}
                    >
                      <SidebarMenuAction className="opacity-100 md:opacity-0 md:group-hover/collapsible:opacity-100">
                        <MoreHorizontal />
                        <span className="sr-only">More</span>
                      </SidebarMenuAction>
                    </ItemActions>
                  )}
                </div>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.documents.length > 0 ? (
                      item.documents.map((document) => (
                        <NavDocument
                          key={document.document_id}
                          document={document}
                          isMobile={isMobile}
                          handleUpdateDocumentAccessedAt={
                            handleUpdateDocumentAccessedAt
                          }
                          updateDocument={updateDocument}
                          deleteDocument={deleteDocument}
                          currentFolderId={item.folderId}
                          availableFolders={availableFolders}
                        />
                      ))
                    ) : (
                      <SidebarMenuItem>
                        <span className="text-muted-foreground p-2 text-sm">
                          No documents found.
                        </span>
                      </SidebarMenuItem>
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>
          ) : null
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
