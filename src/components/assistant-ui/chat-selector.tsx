import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useChats, useCreateChat } from '@/lib/chat/use-chat-queries';

interface ChatSelectorProps {
  documentId: string;
  chatId: string;
  onChatChange: (chatId: string) => void;
  className?: string;
}

/**
 * Chat selector dropdown with "New Chat" button
 * Shows list of chats for the current document
 */
export function ChatSelector({
  documentId,
  chatId,
  onChatChange,
  className,
}: ChatSelectorProps) {
  const { data: chats = [], isLoading } = useChats(documentId);
  const createChatMutation = useCreateChat(documentId);

  const handleCreateChat = async () => {
    try {
      const newChat = await createChatMutation.mutateAsync({
        title: `Chat ${chats.length + 1}`,
      });
      onChatChange(newChat.id);
    } catch (error) {
      console.error('Error creating chat:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-2">
        <Select disabled>
          <SelectTrigger className={className}>
            <SelectValue placeholder="Loading chats..." />
          </SelectTrigger>
        </Select>
        <Button size="icon" variant="outline" disabled>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Select value={chatId} onValueChange={onChatChange}>
        <SelectTrigger className={className}>
          <SelectValue placeholder="Select a chat" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Chats</SelectLabel>
            {chats.map((chat) => (
              <SelectItem key={chat.id} value={chat.id}>
                {chat.title ||
                  `Chat from ${new Date(chat.created_at).toLocaleDateString()}`}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        size="icon"
        variant="outline"
        onClick={handleCreateChat}
        disabled={createChatMutation.isPending}
        title="New Chat"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
