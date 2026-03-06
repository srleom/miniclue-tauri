'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, KeyRound, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useStoreCustomProvider } from '@/hooks/use-queries';
import type { CustomProviderResponse } from '@/lib/types';
import { getErrorMessage } from '@/lib/utils';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  base_url: z
    .string()
    .min(1, 'Base URL is required')
    .url('Must be a valid URL'),
  api_key: z.string().min(1, 'API key is required'),
  model_id: z.string().min(1, 'Model ID is required'),
});

type FormValues = z.infer<typeof schema>;

interface CustomProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** When provided, the dialog is in edit mode and pre-fills the form */
  existing?: CustomProviderResponse;
}

export function CustomProviderDialog({
  open,
  onOpenChange,
  onSuccess,
  existing,
}: CustomProviderDialogProps) {
  const [showKey, setShowKey] = useState(false);
  const storeCustomProvider = useStoreCustomProvider();

  const isEdit = !!existing;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      base_url: '',
      api_key: '',
      model_id: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: existing?.name ?? '',
        base_url: existing?.base_url ?? '',
        api_key: '',
        model_id: existing?.model_id ?? '',
      });
      setShowKey(false);
    }
  }, [open, existing, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      // Use existing id when editing, otherwise generate a new one from name
      const id =
        existing?.id ??
        values.name
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '');

      await storeCustomProvider.mutateAsync({
        id,
        name: values.name,
        base_url: values.base_url,
        api_key: values.api_key,
        model_id: values.model_id,
      });

      toast.success(
        `Custom provider "${values.name}" ${isEdit ? 'updated' : 'added'}`
      );
      form.reset();
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="bg-muted rounded-md border p-2">
              <Server className="size-6" />
            </div>
            <div className="space-y-1">
              <DialogTitle>
                {isEdit ? 'Edit Custom Provider' : 'Add Custom Provider'}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Connect any OpenAI-compatible API endpoint
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="My Provider"
                      disabled={storeCustomProvider.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="base_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Base URL</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="https://api.example.com/v1"
                      disabled={storeCustomProvider.isPending}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    The base URL of the OpenAI-compatible API (without trailing
                    slash)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="api_key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <KeyRound className="text-muted-foreground h-4 w-4" />
                    API Key
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        type={showKey ? 'text' : 'password'}
                        className="pr-10 font-mono text-sm tracking-tight"
                        placeholder={
                          isEdit
                            ? '••••••••  (leave blank to keep current)'
                            : 'Enter your API key'
                        }
                        disabled={storeCustomProvider.isPending}
                        autoComplete="off"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground absolute top-0 right-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                        <span className="sr-only">
                          {showKey ? 'Hide API key' : 'Show API key'}
                        </span>
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="model_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Model ID</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="gpt-4o"
                      disabled={storeCustomProvider.isPending}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    The exact model identifier to use with this provider
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={storeCustomProvider.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={storeCustomProvider.isPending}
                className="min-w-[80px]"
              >
                {storeCustomProvider.isPending
                  ? 'Saving...'
                  : isEdit
                    ? 'Update'
                    : 'Add Provider'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
