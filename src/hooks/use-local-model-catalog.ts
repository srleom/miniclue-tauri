import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getLocalModelStatus,
  getModelCatalog,
  getRecommendedModelId,
} from '@/lib/tauri';
import type { LocalModelStatus } from '@/lib/types';

/**
 * Loads the local model catalog, recommended model ID, and per-model download
 * statuses using TanStack Query. All data is automatically kept fresh:
 * invalidating ['localModelStatus', modelId] (e.g. after a download or delete)
 * will trigger a re-fetch and update this hook's consumers without any manual
 * state management.
 */
export function useLocalModelCatalog() {
  const queryClient = useQueryClient();

  const catalogQuery = useQuery({
    queryKey: ['modelCatalog'],
    queryFn: getModelCatalog,
  });

  const recommendedQuery = useQuery({
    queryKey: ['recommendedModelId'],
    queryFn: getRecommendedModelId,
  });

  const statusQueries = useQueries({
    queries: (catalogQuery.data?.models ?? []).map((model) => ({
      queryKey: ['localModelStatus', model.id] as const,
      queryFn: () => getLocalModelStatus(model.id),
    })),
  });

  // Build a stable Record from the useQueries results
  const statuses: Record<string, LocalModelStatus> = {};
  (catalogQuery.data?.models ?? []).forEach((model, i) => {
    const data = statusQueries[i]?.data;
    if (data) statuses[model.id] = data;
  });

  const isLoading =
    catalogQuery.isPending || statusQueries.some((q) => q.isPending);

  const firstStatusError = statusQueries.find((q) => q.error)?.error;
  const loadError = catalogQuery.error
    ? String(catalogQuery.error)
    : firstStatusError
      ? String(firstStatusError)
      : null;

  /** Marks a single model's status stale; TanStack Query re-fetches it automatically. */
  async function refreshStatus(modelId: string) {
    await queryClient.invalidateQueries({
      queryKey: ['localModelStatus', modelId],
    });
  }

  return {
    catalog: catalogQuery.data ?? null,
    recommendedId: recommendedQuery.data ?? null,
    statuses,
    isLoading,
    loadError,
    refreshStatus,
  };
}
