import type React from 'react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function RenameDialog({
  trigger,
  title,
  description,
  form,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  form: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="sm:max-w-[425px]"
      >
        <DialogHeader className="text-start">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
