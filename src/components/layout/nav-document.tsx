import { Link, useLocation } from '@tanstack/react-router';
import { ItemActions } from '@/components/common/item-actions';
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { MoreHorizontal, Presentation } from 'lucide-react';

type ActionResponse<T> = {
  data?: T;
  error?: string;
};

export default function NavDocument({
  document,
  isMobile,
  handleUpdateDocumentAccessedAt,
  updateDocument,
  deleteDocument,
  availableFolders = [],
  currentFolderId,
}: {
  document: { document_id: string; title: string };
  isMobile: boolean | undefined;
  handleUpdateDocumentAccessedAt: (
    documentId: string
  ) => Promise<ActionResponse<void>>;
  updateDocument: (
    documentId: string,
    title: string
  ) => Promise<ActionResponse<unknown>>;
  deleteDocument: (documentId: string) => Promise<ActionResponse<void>>;
  availableFolders?: Array<{ folderId: string; title: string }>;
  currentFolderId?: string;
}) {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();
  const isActive = location.pathname === `/document/${document.document_id}`;

  const handleNavigation = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <SidebarMenuItem key={document.document_id} className="group/document">
      <SidebarMenuButton
        asChild
        className={
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : undefined
        }
        onClick={async () =>
          await handleUpdateDocumentAccessedAt(document.document_id)
        }
      >
        <Link
          to="/document/$documentId"
          params={{ documentId: document.document_id }}
          onClick={handleNavigation}
        >
          <Presentation />
          <span>{document.title}</span>
        </Link>
      </SidebarMenuButton>
      <ItemActions
        item={{ id: document.document_id, title: document.title }}
        itemType="document"
        renameAction={updateDocument}
        deleteAction={deleteDocument}
        dropdownMenuContentProps={{
          className: 'w-48',
          side: isMobile ? 'bottom' : 'right',
          align: isMobile ? 'end' : 'start',
        }}
        currentFolderId={currentFolderId}
        availableFolders={availableFolders}
      >
        <SidebarMenuAction className="opacity-100 md:opacity-0 md:group-hover/document:opacity-100">
          <MoreHorizontal />
          <span className="sr-only">More</span>
        </SidebarMenuAction>
      </ItemActions>
    </SidebarMenuItem>
  );
}
