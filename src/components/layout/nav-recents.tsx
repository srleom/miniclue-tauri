import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import NavDocument from './nav-document';

type ActionResponse<T> = {
  data?: T;
  error?: string;
};

export type NavRecentsItem = {
  name: string;
  documentId: string;
  folderId: string;
  totalCount?: number;
};

export function NavRecents({
  items,
  handleUpdateDocumentAccessedAt,
  updateDocument,
  deleteDocument,
  availableFolders = [],
}: {
  items: NavRecentsItem[];
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

  const handleNavigation = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="peer group/recents hover:bg-sidebar-accent relative flex w-full items-center justify-between pr-1">
        <span>Recents</span>
        <SidebarGroupAction
          asChild
          className="hover:bg-sidebar-border absolute top-1.5 right-1 group-hover/recents:opacity-100 data-[state=open]:opacity-100 md:opacity-0"
        >
          <Link to="/" onClick={handleNavigation}>
            <Plus />
            <span className="sr-only">Add content</span>
          </Link>
        </SidebarGroupAction>
      </SidebarGroupLabel>
      <SidebarMenu className="max-h-64 overflow-x-hidden overflow-y-auto">
        {items.map((item) => (
          <NavDocument
            key={item.documentId}
            document={{ document_id: item.documentId, title: item.name }}
            isMobile={isMobile}
            handleUpdateDocumentAccessedAt={handleUpdateDocumentAccessedAt}
            updateDocument={updateDocument}
            deleteDocument={deleteDocument}
            availableFolders={availableFolders}
            currentFolderId={item.folderId}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
