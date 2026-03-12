import { useEffect, useRef, useState } from 'react';
import { useUpdateDocument } from '@/hooks/use-queries';

export interface DocumentHeaderProps {
  documentId: string;
  documentTitle: string;
}

export default function DocumentHeader({
  documentId,
  documentTitle,
}: DocumentHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(documentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateDocument = useUpdateDocument();

  // Sync edit value when title changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(documentTitle);
    }
  }, [documentTitle, isEditing]);

  // Select all text when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (editValue.trim() && editValue.trim() !== documentTitle) {
      try {
        await updateDocument.mutateAsync({
          documentId,
          data: { title: editValue.trim() },
        });
      } catch (error) {
        console.error('Error updating document title:', error);
        setEditValue(documentTitle);
      }
    } else {
      setEditValue(documentTitle);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(documentTitle);
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
    <div className="relative inline-flex -mx-2">
      <span
        aria-hidden
        className="invisible whitespace-pre px-2.5 py-0.5 text-sm font-normal"
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
        onClick={isEditing ? undefined : () => setIsEditing(true)}
        title={isEditing ? undefined : 'Click to edit title'}
        className={
          isEditing
            ? 'absolute inset-0 w-full rounded border border-input bg-transparent px-2 py-0.5 text-sm font-normal text-foreground focus:outline-none focus:ring-1 focus:ring-ring'
            : 'absolute inset-0 w-full cursor-default rounded border border-transparent bg-transparent px-2 py-0.5 text-sm font-normal text-foreground transition-colors focus:outline-none hover:bg-accent hover:text-accent-foreground'
        }
      />
    </div>
  );
}
