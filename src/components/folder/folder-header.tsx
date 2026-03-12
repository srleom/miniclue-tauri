import { Folder } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useUpdateFolder } from '@/hooks/use-queries';

export interface FolderHeaderProps {
  folderId: string;
  folderTitle: string;
  isDefault: boolean;
}

export default function FolderHeader({
  folderId,
  folderTitle,
  isDefault,
}: FolderHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(folderTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateFolder = useUpdateFolder();

  // Sync edit value when title changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(folderTitle);
    }
  }, [folderTitle, isEditing]);

  // Select all text when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (editValue.trim() && editValue.trim() !== folderTitle) {
      try {
        await updateFolder.mutateAsync({
          folderId,
          data: { title: editValue.trim() },
        });
      } catch (error) {
        console.error('Error updating folder title:', error);
        setEditValue(folderTitle);
      }
    } else {
      setEditValue(folderTitle);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(folderTitle);
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

  return (
    <div className="mb-7 flex items-center gap-2">
      <Folder />
      <div className="relative inline-flex">
        {/* Sizer: invisible span with identical typography drives the container width */}
        <span
          aria-hidden
          className="invisible whitespace-pre px-2.5 py-1 text-4xl font-semibold"
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
          onClick={
            isDefault || isEditing ? undefined : () => setIsEditing(true)
          }
          title={isDefault || isEditing ? undefined : 'Click to edit title'}
          className={
            isEditing
              ? 'absolute inset-0 w-full rounded border border-input bg-transparent px-2 py-1 text-center text-4xl font-semibold focus:outline-none focus:ring-1 focus:ring-ring'
              : isDefault
                ? 'absolute inset-0 w-full cursor-default border border-transparent bg-transparent px-2 py-1 text-center text-4xl font-semibold focus:outline-none'
                : 'absolute inset-0 w-full cursor-default rounded border border-transparent bg-transparent px-2 py-1 text-center text-4xl font-semibold transition-colors focus:outline-none hover:bg-accent hover:text-accent-foreground'
          }
        />
      </div>
      {isDefault && <Badge variant="outline">Default</Badge>}
    </div>
  );
}
