'use client';

/**
 * 追番更新检查的 TanStack Query Hook
 *
 * 功能：
 * - 自动检查用户明确关注且实际观看过的内容是否有新集数更新
 * - 使用 TanStack Query 管理数据获取和缓存
 * - 替代 watching-updates.ts 的手动缓存实现
 *
 * 工作原理：
 * 1. 获取所有 WatchingFollow
 * 2. 通过安全编码后的 source/id 关联 PlayRecord
 * 3. 并发检查每个关联内容的最新集数
 * 4. 按 App 同款 detail/original/recordTotal/watched 基线算法判断更新
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { watchingFollowsQueryOptions } from './useWatchingFollows';
import { isLocalWatchingFollowMode } from '@/lib/api/watching-follow';
import type { WatchingUpdateObservationInput } from '@/lib/api/watching-updates';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  normalizeContentIdentity,
  resolveContentIdentity,
} from '@/lib/content-identity';
import { getAllPlayRecords } from '@/lib/db.client';
import {
  calculateWatchingUpdate,
  loadWatchCompletionThreshold,
  resolveEffectiveOriginalEpisodes,
  watchedEpisodesForRecord,
} from '@/lib/watching-update-calculation';
import {
  readWatchingUpdateSourceMode,
  subscribeWatchingUpdateSourceMode,
  type WatchingUpdateSourceMode,
} from '@/lib/watching-update-preference';
import {
  mapWatchingUpdateItem,
  type WatchingUpdate,
  type WatchingUpdateDetail,
} from '@/lib/watching-update-result';
import {
  sortWatchingUpdates,
  type WatchingUpdateSortField,
  type WatchingUpdateSortOrder,
} from '@/lib/watching-update-sorter';
import {
  readScopedWatchingUpdatesCache,
  resolveWatchingUpdatesCacheScope,
  sameWatchingUpdatesCacheScope,
  WATCHING_UPDATES_QUERY_ROOT,
  WATCHING_UPDATES_STALE_TIME,
  watchingUpdatesQueryKey,
  writeScopedWatchingUpdatesCache,
  type WatchingUpdatesFreshness,
  type WatchingUpdatesCacheScope,
} from '@/lib/watching-updates-cache';
import {
  watchingUpdatesService,
  type BackendWatchingUpdatesSnapshot,
  type WatchingUpdatesCapabilityState,
} from '@/lib/watching-updates-service';
import { watchingFollowStorageKey } from '@/lib/watching-follow';
import type { PlayRecord, WatchingFollow } from '@/lib/types';

export type {
  WatchingUpdate,
  WatchingUpdateItem,
} from '@/lib/watching-update-result';

// ============================================================================
// Helper Functions
// ============================================================================

export interface WatchingFollowDetectionCandidate {
  follow: WatchingFollow;
  record: PlayRecord & { key: string };
}

/** Build detection inputs by joining explicit follows to playback facts. */
export function buildWatchingFollowCandidates(
  follows: Record<string, WatchingFollow>,
  records: Array<PlayRecord & { key: string }>,
  sourceMap: Map<string, string> = new Map(),
): WatchingFollowDetectionCandidate[] {
  const recordsByIdentity = new Map<string, PlayRecord & { key: string }>();

  for (const record of records) {
    const parsed = resolveContentIdentity(record.key);
    if (!parsed) continue;

    const rawSource = parsed.source;
    const id = parsed.id;
    const source = sourceMap.get(rawSource) ?? rawSource;
    const identity = normalizeContentIdentity(source, id);
    if (identity && !recordsByIdentity.has(identity.identityKey)) {
      recordsByIdentity.set(identity.identityKey, record);
    }
  }

  return Object.values(follows)
    .filter((follow) => follow.enabled)
    .flatMap((follow) => {
      const identity = resolveContentIdentity(follow);
      const record = identity
        ? recordsByIdentity.get(identity.identityKey)
        : undefined;
      return record ? [{ follow, record }] : [];
    });
}

export function calculateWatchingFollowEpisodeState(
  detailEpisodes: number,
  originalEpisodes: number,
  watchedEpisodes: number,
  recordedTotalEpisodes: number,
) {
  const result = calculateWatchingUpdate({
    detailEpisodes,
    originalEpisodes,
    recordTotalEpisodes: recordedTotalEpisodes,
    watchedEpisodes,
  });

  return {
    calculation: result,
    hasUpdate: result.hasUpdate,
    hasNewEpisode: result.hasUpdate,
    hasContinueWatching: false,
    hasNewRelease: false,
    newEpisodes: result.newEpisodes,
    remainingEpisodes: result.remainingEpisodes,
    protectedTotalEpisodes: result.latestEpisodes,
    latestEpisodes: result.latestEpisodes,
    watchedEpisodes: result.watchedEpisodes,
    baselineEpisodes: result.baselineEpisodes,
  };
}

/**
 * 检查单个剧集的更新状态
 */
async function checkSingleRecordUpdate(
  candidate: WatchingFollowDetectionCandidate,
  completionThreshold: number,
): Promise<{
  hasUpdate: boolean;
  hasNewEpisode: boolean;
  hasContinueWatching: boolean;
  hasNewRelease: boolean;
  newEpisodes: number;
  remainingEpisodes: number;
  latestEpisodes: number;
  observedLatestEpisode?: number;
  calculation?: ReturnType<typeof calculateWatchingUpdate>;
  detail?: WatchingUpdateDetail;
}> {
  const { follow, record } = candidate;
  const identity = resolveContentIdentity(follow);
  if (!identity) throw new Error('WatchingFollow identity is invalid');
  try {
    // 调用 API 获取最新详情（使用10分钟时间戳分片缓存）
    // 将时间戳向下取整到10分钟，同一个10分钟内的请求会命中CDN缓存
    // 这样既能获取较新的数据，又能减少对视频源的请求压力
    const cacheKey = Math.floor(Date.now() / 600000) * 600000; // 600000ms = 10分钟
    const apiUrl = `/api/detail?source=${encodeURIComponent(identity.source)}&id=${encodeURIComponent(identity.id)}&_t=${cacheKey}`;
    console.log(`🔍 [追番更新] ${record.title} 调用API:`, apiUrl);
    const response = await fetch(apiUrl, {
      cache: 'no-store',
    });

    if (!response.ok) {
      console.warn(
        `❌ [追番更新] 获取${record.title}详情失败:`,
        response.status,
      );
      return {
        hasUpdate: false,
        hasNewEpisode: false,
        hasContinueWatching: false,
        hasNewRelease: false,
        newEpisodes: 0,
        remainingEpisodes: 0,
        latestEpisodes: Math.max(
          record.total_episodes,
          resolveEffectiveOriginalEpisodes(
            follow.originalEpisodes,
            0,
            record.total_episodes,
          ),
        ),
      };
    }

    const detailData = (await response.json()) as WatchingUpdateDetail & {
      episodes?: unknown;
    };
    // 从 episodes 数组长度获取最新集数（API 返回的是 episodes 数组，不是 total 字段）
    const latestEpisodes = Array.isArray(detailData.episodes)
      ? detailData.episodes.length
      : 0;

    // 添加详细调试信息
    console.log(`📊 [追番更新] ${record.title} API检查详情:`, {
      API返回集数: latestEpisodes,
      当前播放集: record.index,
      播放记录集数: record.total_episodes,
    });

    const originalTotalEpisodes = resolveEffectiveOriginalEpisodes(
      follow.originalEpisodes,
      latestEpisodes,
      record.total_episodes,
    );

    console.log(`📊 [追番更新] ${record.title} 集数对比:`, {
      原始集数: originalTotalEpisodes,
      当前播放记录集数: record.total_episodes,
      API返回集数: latestEpisodes,
    });

    // 检查两种情况：
    // 1. 新集数更新：API返回的集数比观看时的原始集数多
    // 只需要比较原始集数，因为播放记录会被自动更新，不能作为判断依据
    const watchedEpisodes = watchedEpisodesForRecord(
      record,
      completionThreshold,
    );
    const state = calculateWatchingFollowEpisodeState(
      latestEpisodes,
      originalTotalEpisodes,
      watchedEpisodes,
      record.total_episodes,
    );

    // 如果API返回的集数少于原始记录的集数，说明可能是API缓存问题
    if (latestEpisodes < originalTotalEpisodes) {
      console.warn(
        `⚠️ [追番更新] ${record.title} API返回集数(${latestEpisodes})少于原始记录(${originalTotalEpisodes})，可能是API缓存问题`,
      );
    }

    if (state.hasUpdate) {
      console.log(
        `✨ [追番更新] ${record.title} 发现新集数: ${originalTotalEpisodes} -> ${latestEpisodes} 集，新增${state.newEpisodes}集`,
      );

      if (latestEpisodes > record.total_episodes) {
        console.log(
          `📊 [追番更新] 检测到集数差异: ${record.title} 播放记录${record.total_episodes}集 < API最新${latestEpisodes}集`,
        );
        console.log(
          `✅ [追番更新] 已记录新集数信息，等待用户实际观看时自动同步`,
        );
      }
    }

    if (state.hasContinueWatching) {
      console.log(
        `📺 [追番更新] ${record.title} 剩余集数: 已完成到第${state.watchedEpisodes}集，共${state.protectedTotalEpisodes}集，还有${state.remainingEpisodes}集未看`,
      );
    }

    // 输出详细的检测结果
    console.log(`✓ [追番更新] ${record.title} 最终检测结果:`, {
      hasUpdate: state.hasUpdate,
      hasContinueWatching: state.hasContinueWatching,
      newEpisodes: state.newEpisodes,
      remainingEpisodes: state.remainingEpisodes,
      原始集数: originalTotalEpisodes,
      当前播放记录集数: record.total_episodes,
      API返回集数: latestEpisodes,
      保护后集数: state.protectedTotalEpisodes,
      已完成观看到: state.watchedEpisodes,
      计算基线: state.baselineEpisodes,
    });

    return {
      hasUpdate: state.hasUpdate,
      hasNewEpisode: state.hasNewEpisode,
      hasContinueWatching: state.hasContinueWatching,
      hasNewRelease: state.hasNewRelease,
      newEpisodes: state.newEpisodes,
      remainingEpisodes: state.remainingEpisodes,
      latestEpisodes: state.protectedTotalEpisodes,
      observedLatestEpisode: latestEpisodes,
      calculation: state.calculation,
      detail: detailData,
    };
  } catch (error) {
    console.error(`❌ [追番更新] 检查${record.title}更新失败:`, error);
    return {
      hasUpdate: false,
      hasNewEpisode: false,
      hasContinueWatching: false,
      hasNewRelease: false,
      newEpisodes: 0,
      remainingEpisodes: 0,
      latestEpisodes: Math.max(
        record.total_episodes,
        resolveEffectiveOriginalEpisodes(
          follow.originalEpisodes,
          0,
          record.total_episodes,
        ),
      ),
    };
  }
}

// ============================================================================
// Hook: 检查追番更新
// ============================================================================

/**
 * 检查追番更新
 *
 * @example
 * ```tsx
 * function UserMenu() {
 *   const { data: updates, isLoading } = useWatchingUpdatesQuery({
 *     enabled: isOpen && authInfo?.username,
 *   });
 *
 *   if (updates?.hasUpdates) {
 *     return <div>{updates.updatedCount}部有新集</div>;
 *   }
 * }
 * ```
 */
interface LocalWatchingUpdatesPayload {
  data: WatchingUpdate;
  observations: WatchingUpdateObservationInput[];
}

type WatchingUpdatesSyncState = 'idle' | 'syncing' | 'success' | 'error';

export function useWatchingUpdatesQuery(options?: {
  enabled?: boolean;
  forceRefresh?: boolean;
  sortField?: WatchingUpdateSortField;
  sortOrder?: WatchingUpdateSortOrder;
}) {
  const queryClient = useQueryClient();
  const isLocal = isLocalWatchingFollowMode();
  const username = getAuthInfoFromBrowserCookie()?.username;
  const sourceMode = useSyncExternalStore(
    subscribeWatchingUpdateSourceMode,
    readWatchingUpdateSourceMode,
    (): WatchingUpdateSourceMode => 'local',
  );
  const localScope = useMemo(
    () =>
      resolveWatchingUpdatesCacheScope({
        isLocal,
        username,
        sourceMode: 'local',
      }),
    [isLocal, username],
  );
  const backendScope = useMemo(
    () =>
      resolveWatchingUpdatesCacheScope({
        isLocal,
        username,
        sourceMode: 'backend',
      }),
    [isLocal, username],
  );
  const localQueryScope: WatchingUpdatesCacheScope = localScope ?? {
    mode: 'online',
    principal: '__anonymous__',
    sourceMode: 'local',
  };
  const backendQueryScope: WatchingUpdatesCacheScope = backendScope ?? {
    mode: 'online',
    principal: '__anonymous__',
    sourceMode: 'backend',
  };
  const previousScopesRef = useRef<{
    local: WatchingUpdatesCacheScope | null;
    backend: WatchingUpdatesCacheScope | null;
  }>({ local: localScope, backend: backendScope });
  const localInitialCache = localScope
    ? readScopedWatchingUpdatesCache(localScope)
    : undefined;
  const backendInitialCache = backendScope
    ? readScopedWatchingUpdatesCache(backendScope)
    : undefined;

  useEffect(() => {
    const previous = previousScopesRef.current;
    for (const [oldScope, nextScope] of [
      [previous.local, localScope],
      [previous.backend, backendScope],
    ] as const) {
      if (
        oldScope &&
        (!nextScope || !sameWatchingUpdatesCacheScope(oldScope, nextScope))
      ) {
        queryClient.removeQueries({
          queryKey: watchingUpdatesQueryKey(oldScope),
          exact: true,
        });
      }
    }
    previousScopesRef.current = { local: localScope, backend: backendScope };
  }, [backendScope, localScope, queryClient]);

  const capabilityQuery = useQuery({
    queryKey: [
      'watchingUpdatesCapability',
      isLocal ? 'local' : username || '__anonymous__',
    ],
    queryFn: () => watchingUpdatesService.resolveMode('backend'),
    enabled: options?.enabled !== false && sourceMode === 'backend',
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
  const capabilityResolution = capabilityQuery.data;
  const backendAllowed =
    sourceMode === 'backend' &&
    capabilityResolution?.effectiveMode === 'backend';
  const capabilityPending =
    sourceMode === 'backend' &&
    capabilityQuery.isPending &&
    !capabilityResolution;
  const shouldRunLocal =
    sourceMode === 'local' || (sourceMode === 'backend' && !capabilityPending);

  const localQuery = useQuery({
    queryKey: watchingUpdatesQueryKey(localQueryScope),
    queryFn: async (): Promise<LocalWatchingUpdatesPayload> => {
      console.log('🔄 [追番更新] 开始检查追番更新...');

      // 在 queryFn 内部获取共享事实，确保检测使用最新缓存。
      const follows = await queryClient.ensureQueryData(
        watchingFollowsQueryOptions,
      );
      const playRecordsArray = await queryClient.ensureQueryData({
        queryKey: ['playRecords', 'array'],
        queryFn: async () => {
          const data = await getAllPlayRecords(true);
          return Object.entries(data)
            .map(([key, record]) => ({ ...record, key }))
            .sort((a, b) => (b.save_time || 0) - (a.save_time || 0));
        },
      });

      let sourceMap = new Map<string, string>();
      if (Object.values(follows).some((follow) => follow.enabled)) {
        sourceMap = await queryClient.ensureQueryData({
          queryKey: ['sources', 'map'],
          queryFn: async () => {
            const response = await fetch('/api/sources');
            if (!response.ok) throw new Error('Failed to fetch sources');
            const sources = (await response.json()) as Array<{
              key?: string;
              name?: string;
            }>;
            const map = new Map<string, string>();
            for (const source of sources) {
              if (source.key) map.set(source.key, source.key);
              if (source.name && source.key) map.set(source.name, source.key);
            }
            return map;
          },
        });
      }

      const candidates = buildWatchingFollowCandidates(
        follows,
        playRecordsArray,
        sourceMap,
      );
      const completionThreshold = loadWatchCompletionThreshold();
      console.log(
        `🎯 [追番更新] 找到 ${candidates.length} 个 WatchingFollow 检测候选`,
      );

      let updatedCount = 0;
      let successfulChecks = 0;
      const continueWatchingCount = 0;
      const newReleasesCount = 0;
      const observations: WatchingUpdateObservationInput[] = [];
      const updatedSeries: WatchingUpdate['updatedSeries'] = [];
      const previousItems = localScope
        ? (readScopedWatchingUpdatesCache(localScope)?.data.updatedSeries ?? [])
        : [];
      const previousItemsByIdentity = new Map(
        previousItems.map((item) => [item.identityKey, item]),
      );

      const updatePromises = candidates.map(async ({ follow, record }) => {
        try {
          const updateInfo = await checkSingleRecordUpdate(
            { follow, record },
            completionThreshold,
          );
          if (updateInfo.observedLatestEpisode) {
            successfulChecks += 1;
            observations.push({
              followId: watchingFollowStorageKey(follow.source, follow.id),
              source: follow.source,
              resourceId: follow.id,
              latestEpisode: updateInfo.observedLatestEpisode,
              observedAt: Date.now(),
              clientId: 'web',
            });
          }
          if (
            !updateInfo.hasNewEpisode ||
            !updateInfo.calculation ||
            !updateInfo.detail
          ) {
            return null;
          }
          const mappedItem = mapWatchingUpdateItem({
            follow,
            record,
            detail: updateInfo.detail,
            calculation: updateInfo.calculation,
          });
          const previousItem = previousItemsByIdentity.get(
            mappedItem.identityKey,
          );
          const seriesInfo = {
            ...mappedItem,
            detectedAt: resolveLocalDetectedAt(
              previousItem,
              mappedItem.newEpisodes,
              Date.now(),
            ),
          };

          updatedSeries.push(seriesInfo);
          if (updateInfo.hasNewEpisode) updatedCount++;
          return seriesInfo;
        } catch (error) {
          console.error(`[追番更新] 检查${follow.title}更新失败:`, error);
          return null;
        }
      });

      await Promise.all(updatePromises);
      if (
        sourceMode === 'backend' &&
        candidates.length > 0 &&
        successfulChecks === 0
      ) {
        throw new Error('All local Watching Updates checks failed');
      }

      const hasUpdates = updatedCount > 0;
      console.log(
        `✅ [追番更新] 检查完成: ${hasUpdates ? `发现${newReleasesCount}部新上映，${updatedCount}部剧集有新集数更新，${continueWatchingCount}部剧集需要继续观看` : '暂无更新'}`,
      );

      const result: WatchingUpdate = {
        hasUpdates,
        timestamp: Date.now(),
        updatedCount,
        continueWatchingCount,
        newReleasesCount,
        updatedSeries,
      };

      try {
        if (localScope) {
          writeScopedWatchingUpdatesCache(localScope, result);
          console.log('[追番更新] 本地计算结果已保存到 localStorage');
        }
      } catch (error) {
        console.warn('[追番更新] 保存到 localStorage 失败:', error);
      }

      return { data: result, observations };
    },
    staleTime:
      backendAllowed || options?.forceRefresh ? 0 : WATCHING_UPDATES_STALE_TIME,
    gcTime: 60 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    refetchIntervalInBackground: false,
    initialData: localInitialCache
      ? { data: localInitialCache.data, observations: [] }
      : undefined,
    initialDataUpdatedAt: localInitialCache?.timestamp,
    enabled:
      options?.enabled !== false && shouldRunLocal && localScope !== null,
    retry: false,
  });

  const backendQuery = useQuery({
    queryKey: watchingUpdatesQueryKey(backendQueryScope),
    queryFn: async (): Promise<BackendWatchingUpdatesSnapshot> => {
      const snapshot = await watchingUpdatesService.getBackendResults();
      if (backendScope) {
        writeScopedWatchingUpdatesCache(
          backendScope,
          snapshot.data,
          window.localStorage,
          snapshot.freshness,
        );
      }
      return snapshot;
    },
    enabled:
      options?.enabled !== false && backendAllowed && backendScope !== null,
    staleTime: 0,
    gcTime: 60 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    refetchIntervalInBackground: false,
    initialData: backendInitialCache
      ? {
          data: backendInitialCache.data,
          freshness: backendInitialCache.freshness,
        }
      : undefined,
    initialDataUpdatedAt: backendInitialCache?.timestamp,
    retry: false,
  });

  const [syncState, setSyncState] = useState<WatchingUpdatesSyncState>('idle');
  const lastSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    const payload = localQuery.data;
    if (!backendAllowed || !payload || payload.observations.length === 0)
      return;
    const signature = payload.observations
      .map(
        (observation) =>
          `${observation.followId}:${observation.latestEpisode}:${observation.observedAt}`,
      )
      .join('|');
    if (lastSyncedRef.current === signature) return;
    lastSyncedRef.current = signature;
    let cancelled = false;
    setSyncState('syncing');
    void watchingUpdatesService
      .syncObservations(payload.observations)
      .then(async () => {
        if (cancelled) return;
        setSyncState('success');
        await queryClient.invalidateQueries({
          queryKey: watchingUpdatesQueryKey(backendQueryScope),
          exact: true,
        });
      })
      .catch(() => {
        if (!cancelled) setSyncState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [backendAllowed, backendQueryScope, localQuery.data, queryClient]);

  const useBackendQuery = backendAllowed && !backendQuery.isError;
  const activeQuery = useBackendQuery ? backendQuery : localQuery;
  let data = localQuery.data?.data;
  let effectiveSourceMode: WatchingUpdateSourceMode = 'local';
  let freshness: WatchingUpdatesFreshness = localQuery.isError
    ? 'error'
    : localQuery.isFetchedAfterMount
      ? 'fresh'
      : (localInitialCache?.freshness ?? 'fresh');

  if (useBackendQuery) {
    data = backendQuery.data?.data;
    effectiveSourceMode = 'backend';
    freshness = backendQuery.data?.freshness ?? 'stale';
  } else if (backendAllowed && backendQuery.isError) {
    data = localQuery.data?.data ?? backendQuery.data?.data;
    freshness = 'error';
  } else if (
    sourceMode === 'backend' &&
    capabilityResolution?.capabilityState === 'error'
  ) {
    freshness = 'error';
  }

  const capabilityState: WatchingUpdatesCapabilityState =
    sourceMode === 'local'
      ? 'idle'
      : capabilityPending
        ? 'checking'
        : (capabilityResolution?.capabilityState ?? 'error');
  const sortedData = useMemo(
    () =>
      data
        ? {
            ...data,
            updatedSeries: sortWatchingUpdates(data.updatedSeries, {
              field: options?.sortField ?? 'name',
              order: options?.sortOrder,
            }),
          }
        : data,
    [data, options?.sortField, options?.sortOrder],
  );

  return {
    ...activeQuery,
    data: capabilityPending ? undefined : sortedData,
    sourceMode,
    effectiveSourceMode,
    capabilityState,
    freshness,
    syncState,
  };
}

export function resolveLocalDetectedAt(
  previous: WatchingUpdate['updatedSeries'][number] | undefined,
  newEpisodes: number,
  detectedAt: number,
): number | undefined {
  if (newEpisodes <= 0) return undefined;
  if (
    typeof previous?.detectedAt === 'number' &&
    newEpisodes <= previous.newEpisodes
  ) {
    return previous.detectedAt;
  }
  return detectedAt;
}

/**
 * 手动触发追番更新检查
 */
export function useRefreshWatchingUpdates() {
  const queryClient = useQueryClient();

  return () => {
    // 强制刷新播放记录（type: 'all' 确保即使 inactive 也会刷新）
    queryClient.invalidateQueries({
      queryKey: ['playRecords'],
      refetchType: 'all',
    });
    // 强制刷新关注事实，确保新增或取消关注立即影响候选。
    queryClient.invalidateQueries({
      queryKey: ['watchingFollows'],
      refetchType: 'all',
    });
    // 强制刷新追番更新（type: 'all' 确保即使 inactive 也会刷新）
    queryClient.invalidateQueries({
      queryKey: WATCHING_UPDATES_QUERY_ROOT,
      refetchType: 'all',
    });
  };
}
