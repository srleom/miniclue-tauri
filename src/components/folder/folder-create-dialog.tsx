import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useCreateFolder } from '@/hooks/use-queries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface FolderCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FolderCreateDialog({
  open,
  onOpenChange,
}: FolderCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const createFolder = useCreateFolder();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Please enter a folder title');
      return;
    }

    try {
      await createFolder.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      toast.success('Folder created successfully');
      setTitle('');
      setDescription('');
      onOpenChange(false);
    } catch {
      toast.error('Failed to create folder');
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setTitle('');
      setDescription('');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Folder</DialogTitle>
          <DialogDescription>
            Add a new folder to organize your documents
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="folder-title">Title</Label>
            <Input
              id="folder-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter folder title"
              disabled={createFolder.isPending}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-description">Description (optional)</Label>
            <Textarea
              id="course-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter course description"
              disabled={createFolder.isPending}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createFolder.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createFolder.isPending || !title.trim()}
            >
              {createFolder.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
