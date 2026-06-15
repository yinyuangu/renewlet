import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import type { UploadedAsset, UploadedAssetsPage, UploadKind } from "@/lib/api/schemas/media";
import { assetService } from "@/services/asset-service";

export const uploadedAssetsQueryKeys = {
  all: ["uploaded-assets"] as const,
  byKind: (kind: UploadKind) => [...uploadedAssetsQueryKeys.all, "kind", kind] as const,
};

export interface UploadedAssetsByKindResult {
  assets: UploadedAsset[];
  error: Error | null;
  hasLoaded: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
}

export function invalidateUploadedAssetsQueries(queryClient: QueryClient, kind?: UploadKind) {
  return queryClient.invalidateQueries({
    queryKey: kind ? uploadedAssetsQueryKeys.byKind(kind) : uploadedAssetsQueryKeys.all,
  });
}

export function removeUploadedAssetFromQueryCache(queryClient: QueryClient, asset: UploadedAsset) {
  queryClient.setQueryData<InfiniteData<UploadedAssetsPage, number>>(
    uploadedAssetsQueryKeys.byKind(asset.kind),
    (current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== asset.id),
        })),
      };
    },
  );
}

export function useUploadedAssetsByKind(
  kind: UploadKind,
  options: { enabled?: boolean } = {},
): UploadedAssetsByKindResult {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(options.enabled ?? false);
  const query = useInfiniteQuery({
    queryKey: uploadedAssetsQueryKeys.byKind(kind),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => assetService.list(kind, pageParam),
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled,
  });

  const assets = useMemo(() => {
    if (!enabled) return [];
    return mergeAssets(query.data?.pages.flatMap((page) => page.items) ?? []);
  }, [enabled, query.data?.pages]);
  const error = query.error instanceof Error ? query.error : query.error ? new Error("Uploaded assets load failed") : null;
  const hasLoaded = enabled && (query.isFetched || query.isError);
  const isLoading = enabled && query.isFetching && !query.isFetchingNextPage && !query.data;
  const isLoadingMore = enabled && query.isFetchingNextPage;

  const refresh = useCallback(async () => {
    setEnabled(true);
    if (!enabled) return;
    await query.refetch();
  }, [enabled, query]);

  const loadMore = useCallback(async () => {
    if (!enabled) {
      setEnabled(true);
      return;
    }
    if (!query.hasNextPage || query.isFetching || query.isFetchingNextPage) return;
    await query.fetchNextPage();
  }, [enabled, query]);

  const reset = useCallback(() => {
    setEnabled(false);
    // 只重置当前调用方的可见状态，不清全局缓存；设置页管理器和 LogoPicker 共享同一资产事实源。
    void queryClient.cancelQueries({ queryKey: uploadedAssetsQueryKeys.byKind(kind) });
  }, [kind, queryClient]);

  return {
    assets,
    error,
    hasLoaded,
    hasMore: enabled && Boolean(query.hasNextPage),
    isLoading,
    isLoadingMore,
    refresh,
    loadMore,
    reset,
  };
}

function mergeAssets(items: UploadedAsset[]): UploadedAsset[] {
  const seen = new Set<string>();
  const merged: UploadedAsset[] = [];
  for (const asset of items) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    merged.push(asset);
  }
  return merged;
}
