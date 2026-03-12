import { zodResolver } from '@hookform/resolvers/zod';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';
import {
  providerDisplayNames,
  providerHelpUrls,
} from '@/components/settings/provider-constants';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useStoreApiKey } from '@/hooks/use-queries';
import type { Provider } from '@/lib/types';
import { getErrorMessage } from '@/lib/utils';

const apiKeySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});
type ApiKeyFormValues = z.infer<typeof apiKeySchema>;

interface ApiKeyInlineFormProps {
  provider: Provider;
  hasKey: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ApiKeyInlineForm({
  provider,
  hasKey,
  onSuccess,
  onCancel,
}: ApiKeyInlineFormProps) {
  const [showKey, setShowKey] = useState(false);
  const storeApiKey = useStoreApiKey();

  const form = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: { apiKey: '' },
  });

  const onSubmit = async (values: ApiKeyFormValues) => {
    try {
      await storeApiKey.mutateAsync({ provider, apiKey: values.apiKey });
      toast.success(
        `${providerDisplayNames[provider]} API key ${hasKey ? 'updated' : 'connected'}`
      );
      form.reset();
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const placeholder =
    provider === 'openai'
      ? 'sk-...'
      : provider === 'anthropic'
        ? 'sk-ant-...'
        : 'Enter your API key';

  return (
    <div className="mt-2 pt-3">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <FormField
            control={form.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="relative">
                    <Input
                      {...field}
                      type={showKey ? 'text' : 'password'}
                      className="pr-10 font-mono text-sm tracking-tight"
                      placeholder={placeholder}
                      disabled={storeApiKey.isPending}
                      autoComplete="off"
                      autoFocus
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
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => openUrl(providerHelpUrls[provider])}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
            >
              Get {providerDisplayNames[provider]} key
              <ExternalLink className="h-3 w-3" />
            </button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={storeApiKey.isPending}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={storeApiKey.isPending}
                className="text-xs"
              >
                {storeApiKey.isPending
                  ? 'Saving...'
                  : hasKey
                    ? 'Update'
                    : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
