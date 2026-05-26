import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { systemService } from "@/services/system-service";

export const systemVersionQueryKey = ["system-version"] as const;

export function useSystemVersion(enabled: boolean, force = false) {
  return useQuery({
    queryKey: [...systemVersionQueryKey, force],
    queryFn: ({ signal }) => systemService.version(force, signal),
    enabled,
    retry: false,
    staleTime: 20 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useSystemUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => systemService.update(),
    onSuccess: () => {
      // 更新成功后旧进程即将退出，先清版本缓存，重启完成后的下一次查询必须重新命中新进程。
      void queryClient.invalidateQueries({ queryKey: systemVersionQueryKey });
    },
  });
}
