import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface RenameFormProps {
  id: string;
  defaultValue: string;
  action: (id: string, name: string) => Promise<{ error?: string }>;
  successMessage: string;
  onSuccess?: () => void;
}

export function RenameForm({
  id,
  defaultValue,
  action,
  successMessage,
  onSuccess,
}: RenameFormProps) {
  return (
    <form
      action={async (formData: FormData) => {
        const name = formData.get('name') as string;
        const result = await action(id, name);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success(successMessage);
          onSuccess?.();
        }
      }}
      className="grid gap-4"
    >
      <div className="grid gap-3">
        <Input id={`rename-${id}`} name="name" defaultValue={defaultValue} />
      </div>
      <DialogFooter className="flex-row justify-start gap-2 sm:justify-end">
        <DialogClose asChild>
          <Button variant="outline" className="w-auto">
            Cancel
          </Button>
        </DialogClose>
        <DialogClose asChild>
          <Button type="submit" className="w-auto">
            Save
          </Button>
        </DialogClose>
      </DialogFooter>
    </form>
  );
}
