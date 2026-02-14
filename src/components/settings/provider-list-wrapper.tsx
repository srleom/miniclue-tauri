'use client';

// react
import { useState, useEffect } from 'react';

// components
import { ProviderList } from './provider-list';
import type { Provider } from '@/lib/types';

interface ProviderListWrapperProps {
  initialStatus: Record<Provider, boolean>;
}

export function ProviderListWrapper({
  initialStatus,
}: ProviderListWrapperProps) {
  const [apiKeysStatus, setApiKeysStatus] =
    useState<Record<Provider, boolean>>(initialStatus);

  // Update local state when initialStatus changes (after refresh)
  useEffect(() => {
    console.log(
      `[ProviderListWrapper] initialStatus changed:`,
      JSON.stringify(initialStatus, null, 2)
    );
    console.log(`[ProviderListWrapper] Updating local state with new values`);
    setApiKeysStatus(initialStatus);
  }, [initialStatus]);

  const handleUpdate = (provider: Provider) => {
    console.log(
      `[ProviderListWrapper] Optimistically updating status for ${provider}`
    );

    // Optimistically update the status
    setApiKeysStatus((prev) => ({
      ...prev,
      [provider]: true,
    }));

    // Note: Query invalidation is already handled by the mutation's onSuccess callback
    // No need to invalidate again here to avoid race conditions
  };

  return <ProviderList apiKeysStatus={apiKeysStatus} onUpdate={handleUpdate} />;
}
