import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  getWatchCompletionThresholdPreference,
  saveWatchCompletionThresholdPreference,
} from '@/lib/api/watch-completion-threshold';
import { mapFavoriteReminderIdentityItem } from '@/lib/favorite-reminder-identity';
import { normalizePlayRecordKeys } from '@/lib/play-record';
import type { PlayRecord } from '@/lib/types';
import { checkForUpdates, type UpdateStatus } from '@/lib/version_check';
import {
  DEFAULT_WATCH_COMPLETION_THRESHOLD,
  loadWatchCompletionThreshold,
} from '@/lib/watching-update-calculation';
import { WATCHING_UPDATES_QUERY_ROOT } from '@/lib/watching-updates-cache';

// ─── Emby Config Types ──────────────────────────────────────────────────────

export interface EmbySource {
  key: string;
  name: string;
  enabled: boolean;
  ServerURL: string;
  ApiKey?: string;
  Username?: string;
  Password?: string;
  removeEmbyPrefix?: boolean;
  appendMediaSourceId?: boolean;
  transcodeMp4?: boolean;
  proxyPlay?: boolean;
}

export interface EmbyConfig {
  sources: EmbySource[];
}

// ─── Emby Config Query Options (reusable key, type-safe) ─────────────────────

export const embyConfigQueryOptions = queryOptions({
  queryKey: ['user', 'emby-config'] as const,
  queryFn: async (): Promise<EmbyConfig> => {
    const res = await fetch('/api/user/emby-config');
    const data = await res.json();
    if (data.success && data.config) {
      return data.config as EmbyConfig;
    }
    return { sources: [] };
  },
  staleTime: 5 * 60 * 1000, // 5 minutes - config rarely changes
  gcTime: 30 * 60 * 1000,
});

/**
 * Fetch user Emby config
 * Only fetches when isSettingsOpen - use enabled option at call site
 */
export function useEmbyConfigQuery(enabled: boolean) {
  return useQuery({
    ...embyConfigQueryOptions,
    enabled,
  });
}

export const watchCompletionThresholdQueryKey = (username: string) =>
  ['watchCompletionThreshold', username] as const;

/**
 * Web 设置面板读取用户观看完成阈值的唯一 Hook。
 * 本次变更把 Settings UI 与 API/localStorage 细节隔离开：组件只消费 query 数据，
 * 账号级缓存和后端同步由 client service 处理，未登录时保持默认 80 且不会触发匿名请求。
 */
export function useWatchCompletionThresholdQuery({
  enabled,
  username,
}: {
  enabled: boolean;
  username?: string | null;
}) {
  const principal = username?.trim() || null;

  return useQuery({
    queryKey: watchCompletionThresholdQueryKey(principal ?? '__anonymous__'),
    queryFn: () =>
      getWatchCompletionThresholdPreference({ username: principal }),
    enabled: enabled && !!principal,
    initialData: () =>
      principal
        ? loadWatchCompletionThreshold(principal)
        : DEFAULT_WATCH_COMPLETION_THRESHOLD,
    initialDataUpdatedAt: 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Web 设置面板保存用户观看完成阈值的唯一 Hook。
 * 保存成功后同时更新当前账号阈值 query，并让 Watching Update 根查询失效，
 * 确保本地追更计算下一次读取的是同一份后端用户偏好。
 */
export function useSaveWatchCompletionThresholdMutation(
  username?: string | null,
) {
  const queryClient = useQueryClient();
  const principal = username?.trim() || null;

  return useMutation({
    mutationFn: (threshold: number) =>
      saveWatchCompletionThresholdPreference({
        username: principal,
        threshold,
      }),
    onSuccess: (threshold) => {
      if (principal) {
        queryClient.setQueryData(
          watchCompletionThresholdQueryKey(principal),
          threshold,
        );
        queryClient.invalidateQueries({
          queryKey: watchCompletionThresholdQueryKey(principal),
        });
      }
      queryClient.invalidateQueries({ queryKey: WATCHING_UPDATES_QUERY_ROOT });
    },
  });
}

/**
 * Save Emby config mutation
 * Invalidates emby-config query on success so ModernNav etc. refresh
 */
export function useSaveEmbyConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: EmbyConfig) => {
      const res = await fetch('/api/user/emby-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || '保存失败');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: embyConfigQueryOptions.queryKey,
      });
    },
  });
}

/**
 * Query options for watch room config
 */
const watchRoomConfigOptions = () =>
  queryOptions({
    queryKey: ['watchRoomConfig'],
    queryFn: async () => {
      const response = await fetch('/api/watch-room/config');
      const config = await response.json();
      return config.enabled === true;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes - config rarely changes
    gcTime: 30 * 60 * 1000,
  });

/**
 * Fetch watch room config
 */
export function useWatchRoomConfigQuery() {
  return useQuery(watchRoomConfigOptions());
}

/**
 * Query options for server config
 */
const serverConfigOptions = () =>
  queryOptions({
    queryKey: ['serverConfig'],
    queryFn: async () => {
      const response = await fetch('/api/server-config');
      if (response.ok) {
        const config = await response.json();
        return { downloadEnabled: config.DownloadEnabled ?? true };
      }
      return { downloadEnabled: true };
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000,
  });

/**
 * Fetch server config (download enabled, etc.)
 */
export function useServerConfigQuery() {
  return useQuery(serverConfigOptions());
}

/**
 * Query options for version check
 */
const versionCheckOptions = () =>
  queryOptions<UpdateStatus>({
    queryKey: ['versionCheck'],
    queryFn: () => checkForUpdates(),
    staleTime: 30 * 60 * 1000, // 30 minutes - no need to check frequently
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

/**
 * Check for version updates
 */
export function useVersionCheckQuery() {
  return useQuery(versionCheckOptions());
}

interface UsePlayRecordsQueryOptions {
  enabled: boolean;
  enableFilter: boolean;
  minProgress: number;
  maxProgress: number;
}

/**
 * Query options for play records with filtering
 * 使用新的 usePlayRecordsQuery 作为数据源
 */
const playRecordsOptions = (
  enableFilter: boolean,
  minProgress: number,
  maxProgress: number,
) =>
  queryOptions({
    queryKey: [
      'playRecords',
      'userMenu',
      enableFilter,
      minProgress,
      maxProgress,
    ],
    queryFn: async () => {
      // 使用 fetch 直接获取，因为这里需要在 queryFn 内部调用
      const response = await fetch('/api/playrecords');
      if (!response.ok) {
        throw new Error(`Failed to fetch play records: ${response.status}`);
      }
      const records = normalizePlayRecordKeys(
        (await response.json()) as Record<string, PlayRecord>,
      ).records;

      const recordsArray = Object.entries(records).map(([key, record]) => ({
        ...record,
        key,
      }));

      // Filter records that need continue watching
      const validPlayRecords = recordsArray.filter((record) => {
        const progress =
          record.total_time === 0
            ? 0
            : (record.play_time / record.total_time) * 100;

        // Play time must exceed 2 minutes
        if (record.play_time < 120) return false;

        // If filter is disabled, show all records with > 2 min playtime
        if (!enableFilter) return true;

        // Filter by user's custom progress range
        return progress >= minProgress && progress <= maxProgress;
      });

      // Sort by last play time descending
      const sortedRecords = validPlayRecords.sort(
        (a, b) => b.save_time - a.save_time,
      );
      // 修改点：不再在此处截取前 12 条 —— 继续观看排序（与 APP 同款）需要在
      // UserMenu 组件内先按共享排序偏好重排，再截取前 12 条，否则非默认排序时
      // 会丢失「最近 12 条」之外的记录。默认排序下组件内的截取结果与原行为一致。
      return sortedRecords;
    },
    staleTime: 15 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
  });

/**
 * Fetch play records with filtering
 */
export function usePlayRecordsQuery({
  enabled,
  enableFilter,
  minProgress,
  maxProgress,
}: UsePlayRecordsQueryOptions) {
  return useQuery({
    ...playRecordsOptions(enableFilter, minProgress, maxProgress),
    enabled,
  });
}

interface UseFavoritesQueryOptions {
  enabled: boolean;
}

/**
 * Query options for favorites list
 * 使用新的 useFavoritesQuery 作为数据源
 */
const favoritesOptions = () =>
  queryOptions({
    queryKey: ['favorites', 'userMenu'],
    queryFn: async () => {
      const response = await fetch('/api/favorites');
      if (response.ok) {
        const favoritesData = (await response.json()) as Record<string, any>;
        const favoritesArray = Object.entries(favoritesData)
          .map(([key, favorite]) =>
            mapFavoriteReminderIdentityItem(key, favorite),
          )
          .filter((favorite) => favorite !== null);
        // Sort by save time descending
        return favoritesArray.sort((a, b) => b.save_time - a.save_time);
      }
      return [];
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000,
  });

/**
 * Fetch favorites list
 */
export function useFavoritesQuery({ enabled }: UseFavoritesQueryOptions) {
  return useQuery({
    ...favoritesOptions(),
    enabled,
  });
}

/**
 * Change password mutation
 * Based on TanStack Query useMutation pattern from source code
 */
export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: async (newPassword: string) => {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '修改密码失败');
      }

      return data;
    },
  });
}

/**
 * Invalidate play records and favorites queries
 * Useful when external events update data
 */
export function useInvalidateUserMenuData() {
  const queryClient = useQueryClient();

  return {
    invalidatePlayRecords: () => {
      queryClient.invalidateQueries({ queryKey: ['playRecords'] });
    },
    invalidateFavorites: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['playRecords'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  };
}
