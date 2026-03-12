import { Check, Server, Trash2 } from 'lucide-react';
import type React from 'react';
import { Button } from '@/components/ui/button';
import type { CustomProviderResponse } from '@/lib/types';
import { ProviderBadge } from './provider-badge';

interface CustomProviderCardProps {
  cp: CustomProviderResponse;
  deleteCustomProviderPending: boolean;
  onEdit: (cp: CustomProviderResponse) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

export function CustomProviderCard({
  cp,
  deleteCustomProviderPending,
  onEdit,
  onDelete,
}: CustomProviderCardProps) {
  return (
    <div className="bg-card hover:bg-accent/50 flex min-h-[60px] items-center justify-between rounded-lg border p-4 text-sm transition-colors">
      <div className="flex items-center gap-3">
        <Server className="size-6" />
        <div>
          <div className="flex items-center gap-2 font-medium">
            {cp.name}
            <ProviderBadge variant="custom" />
          </div>
          <p className="text-muted-foreground text-xs">{cp.base_url}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-sm text-green-600">
          <Check className="h-4 w-4" />
          <span>Active</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(cp)}
          className="gap-1 text-xs"
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => onDelete(cp.id, e)}
          className="text-destructive hover:text-destructive"
          disabled={deleteCustomProviderPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
