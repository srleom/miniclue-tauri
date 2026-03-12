import { History, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import DeleteDialog from '@/components/common/delete-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useChat,
  useChats,
  useCreateChat,
  useDeleteChat,
  useUpdateChat,
} from '@/lib/chat/use-chat-queries';
import { cn } from '@/lib/utils';

interface ChatHeaderProps {
  documentId: string;
  chatId: string;
  onChatChange: (chatId: string) => void;
}

/**
 * Chat header component with editable title and action buttons
 *
 * Features:
 * - Editable chat title (click to edit, save on blur/Enter)
 * - History dropdown showing all chats (max 4 visible, then scroll)
 * - Plus button to create new chat with "New Chat" title
 */
export function ChatHeader({
  documentId,
  chatId,
  onChatChange,
}: ChatHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: chats = [], isLoading: isLoadingChats } = useChats(documentId);
  const { data: currentChat } = useChat(documentId, chatId);
  const createChatMutation = useCreateChat(documentId);
  const updateChatMutation = useUpdateChat(documentId, chatId);
  const deleteChatMutation = useDeleteChat(documentId);

  // Sync edit value when title changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(currentChat?.title || 'New Chat');
    }
  }, [currentChat, isEditing]);

  // Select all text when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    setIsEditing(true);
  };

  const handleSave = async () => {
    const currentTitle = currentChat?.title || 'New Chat';
    const trimmedTitle = editValue.trim();

    if (trimmedTitle && trimmedTitle !== currentTitle) {
      try {
        await updateChatMutation.mutateAsync({
          title: trimmedTitle,
        });
      } catch (error) {
        console.error('Error updating chat title:', error);
        setEditValue(currentTitle);
      }
    } else {
      setEditValue(currentTitle);
    }

    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(currentChat?.title || 'New Chat');
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleCreateChat = async () => {
    try {
      const newChat = await createChatMutation.mutateAsync({
        title: 'New Chat',
      });
      onChatChange(newChat.id);
    } catch (error) {
      console.error('Error creating chat:', error);
    }
  };

  const handleDeleteChat = async (chatIdToDelete: string) => {
    // Edge case 1: If deleting current chat, switch to another first
    if (chatIdToDelete === chatId) {
      const alternativeChat = chats.find((c) => c.id !== chatIdToDelete);

      // Edge case 2: If this is the last chat, create new one first
      if (!alternativeChat) {
        try {
          const newChat = await createChatMutation.mutateAsync({
            title: 'New Chat',
          });
          onChatChange(newChat.id);
        } catch (error) {
          console.error('Error creating chat before delete:', error);
          toast.error('Failed to create new chat');
          return; // Don't proceed with deletion
        }
      } else {
        onChatChange(alternativeChat.id);
      }
    }

    // Now delete the chat
    const toastId = toast.loading('Deleting chat...');
    try {
      await deleteChatMutation.mutateAsync(chatIdToDelete);
      toast.success('Chat deleted');
    } catch (error) {
      console.error('Error deleting chat:', error);
      toast.error('Failed to delete chat');
    } finally {
      toast.dismiss(toastId);
    }
  };

  return (
    <div className="flex items-center justify-between w-full">
      {/* Left: Editable Chat Title */}
      <div className="flex-1 min-w-0">
        <div className="relative inline-flex max-w-[320px]">
          {/* Sizer: invisible span with identical typography drives the container width */}
          <span
            aria-hidden
            className="invisible whitespace-pre px-2.5 py-1 text-base font-medium"
          >
            {editValue || '\u00A0'}
          </span>
          <input
            ref={inputRef}
            type="text"
            readOnly={!isEditing}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={isEditing ? handleSave : undefined}
            onKeyDown={isEditing ? handleKeyDown : undefined}
            onClick={isEditing ? undefined : handleStartEdit}
            title={isEditing ? undefined : 'Click to edit title'}
            className={
              isEditing
                ? 'absolute inset-0 w-full rounded border border-input bg-transparent px-2 py-1 text-base font-medium focus:outline-none focus:ring-1 focus:ring-ring'
                : 'absolute inset-0 w-full cursor-default rounded border border-transparent bg-transparent px-2 py-1 text-left text-base font-medium transition-colors focus:outline-none hover:bg-accent hover:text-accent-foreground truncate'
            }
          />
        </div>
      </div>

      {/* Right: History and Plus Buttons */}
      <div className="flex items-center gap-1">
        {/* History Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="Chat History">
              <History className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[250px]">
            <DropdownMenuLabel>Chat History</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isLoadingChats ? (
              <div className="p-2 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : chats.length === 0 ? (
              <div className="p-2 text-center text-sm text-muted-foreground">
                No chats yet
              </div>
            ) : (
              <div className="max-h-[320px] overflow-y-auto">
                {chats.map((chat) => (
                  <DropdownMenuItem
                    key={chat.id}
                    className={cn('group', chat.id === chatId && 'bg-accent')}
                    onSelect={(e) => e.preventDefault()} // Prevent auto-close on click
                  >
                    <div className="flex items-center justify-between w-full gap-2">
                      {/* Chat title - clickable to switch */}
                      <button
                        type="button"
                        className="block truncate flex-1 min-w-0 cursor-default text-left"
                        onClick={() => onChatChange(chat.id)}
                      >
                        {chat.title ||
                          `Chat from ${new Date(chat.created_at).toLocaleDateString()}`}
                      </button>

                      {/* Delete button - show on hover */}
                      <DeleteDialog
                        title="Delete this chat?"
                        description="This will delete all messages in this chat. This action cannot be undone."
                        onConfirm={() => handleDeleteChat(chat.id)}
                      >
                        <button
                          type="button"
                          className="opacity-0 group-hover:opacity-100 shrink-0 rounded-sm p-1 cursor-default hover:bg-destructive/10 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Delete chat"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </DeleteDialog>
                    </div>
                  </DropdownMenuItem>
                ))}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* New Chat Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCreateChat}
          disabled={createChatMutation.isPending}
          title="New Chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
