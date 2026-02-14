'use client';

// react
import { useState, useEffect } from 'react';

// third-party
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import * as z from 'zod';

// icons
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

// components
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge'; // Ensure you have this component
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
import { cn, getErrorMessage } from '@/lib/utils'; // standard shadcn utility

// actions & types
import { useStoreApiKey } from '@/hooks/use-queries';
import type { Provider } from '@/lib/types';
import {
  providerDisplayNames,
  providerLogos,
  providerHelpUrls,
} from './provider-constants';

const apiKeySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

type ApiKeyFormValues = z.infer<typeof apiKeySchema>;

interface ApiKeyDialogProps {
  provider: Provider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  hasKey: boolean;
}

export function ApiKeyDialog({
  provider,
  open,
  onOpenChange,
  onSuccess,
  hasKey,
}: ApiKeyDialogProps) {
  const [showKey, setShowKey] = useState(false); // State for visibility toggle
  const storeApiKey = useStoreApiKey();

  const form = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: {
      apiKey: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({ apiKey: '' });
    }
  }, [open, form]);

  // Reset password visibility when dialog closes
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowKey(false);
    }
  }, [open]);

  const onSubmit = async (values: ApiKeyFormValues) => {
    try {
      console.log(`[ApiKeyDialog] Storing API key for ${provider}...`);

      await storeApiKey.mutateAsync({
        provider,
        apiKey: values.apiKey,
      });

      console.log(
        `[ApiKeyDialog] API key stored successfully, mutation complete (including refetch + delay)`
      );

      toast.success(
        `${providerDisplayNames[provider]} API key ${hasKey ? 'updated' : 'connected'}`
      );

      console.log(`[ApiKeyDialog] Toast shown, calling onSuccess callback`);
      form.reset();
      onSuccess?.();

      console.log(`[ApiKeyDialog] Closing dialog`);
      onOpenChange(false);

      console.log(`[ApiKeyDialog] Dialog closed successfully`);
    } catch (error) {
      console.error(`[ApiKeyDialog] Error storing API key:`, error);
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 sm:max-w-[500px]">
        {/* Header Section */}
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-muted rounded-md border p-2">
                {/* Assuming providerLogos returns an SVG/Icon component */}
                {providerLogos[provider]}
              </div>
              <div className="space-y-1">
                <DialogTitle>{providerDisplayNames[provider]}</DialogTitle>
                <DialogDescription className="text-xs">
                  Configure your provider settings
                </DialogDescription>
              </div>
            </div>
            {/* Status Badge */}
            <Badge
              variant={hasKey ? 'default' : 'secondary'}
              className={cn(
                'gap-1.5 px-2.5 py-0.5 transition-colors',
                hasKey
                  ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25'
                  : 'text-muted-foreground'
              )}
            >
              {hasKey ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connected
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5" />
                  Not Connected
                </>
              )}
            </Badge>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="apiKey"
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
                        className="pr-10 font-mono text-sm tracking-tight" // Monospace for keys
                        placeholder={
                          provider === 'openai'
                            ? 'sk-...'
                            : provider === 'anthropic'
                              ? 'sk-ant-...'
                              : 'Enter your API key'
                        }
                        disabled={storeApiKey.isPending}
                        autoComplete="off"
                      />
                      {/* Toggle Visibility Button */}
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

                  {/* Security Note */}
                  <FormDescription className="text-muted-foreground/80 mt-2 flex items-center gap-1.5 text-xs">
                    <ShieldCheck className="h-3.5 w-3.5 text-green-600/80" />
                    Encrypted and stored securely. Never shared with third
                    parties.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Helper Box */}
            <div className="bg-muted/40 group hover:bg-muted/60 flex items-center justify-between rounded-lg border p-3 text-sm transition-colors">
              <span className="text-muted-foreground text-xs">
                Don&apos;t have an API key?
              </span>
              <a
                href={providerHelpUrls[provider]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                Get {providerDisplayNames[provider]} Key
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={storeApiKey.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={storeApiKey.isPending}
                className="min-w-[80px]"
              >
                {storeApiKey.isPending
                  ? 'Saving...'
                  : hasKey
                    ? 'Update key'
                    : 'Save key'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
