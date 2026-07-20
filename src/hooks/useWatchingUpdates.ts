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
import { useEffect, useMemo, useRef } from 'react';
import { watchingFollowsQueryOptions } from './useWatchingFollows';
import { isLocalWatchingFollowMode } from '@/lib/api/watching-follow';
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
  mapWatchingUpdateItem,
  type WatchingUpdate,
  type WatchingUpdateDetail,
} from '@/lib/watching-update-result';
import {
  readScopedWatchingUpdatesCache,
  resolveWatchingUpdatesCacheScope,
  sameWatchingUpdatesCacheScope,
  WATCHING_UPDATES_QUERY_ROOT,
  WATCHING_UPDATES_STALE_TIME,
  watchingUpdatesQueryKey,
  writeScopedWatchingUpdatesCache,
  type WatchingUpdatesCacheScope,
} from '@/lib/watching-updates-cache';
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
export function useWatchingUpdatesQuery(options?: {
  enabled?: boolean;
  forceRefresh?: boolean;
}) {
  const queryClient = useQueryClient();
  const isLocal = isLocalWatchingFollowMode();
  const username = getAuthInfoFromBrowserCookie()?.username;
  const scope = useMemo(
    () => resolveWatchingUpdatesCacheScope({ isLocal, username }),
    [isLocal, username],
  );
  const queryScope: WatchingUpdatesCacheScope = scope ?? {
    mode: 'online',
    principal: '__anonymous__',
  };
  const previousScopeRef = useRef<WatchingUpdatesCacheScope | null>(scope);
  const initialCache = scope
    ? readScopedWatchingUpdatesCache(scope)
    : undefined;

  useEffect(() => {
    const previousScope = previousScopeRef.current;
    if (
      previousScope &&
      (!scope || !sameWatchingUpdatesCacheScope(previousScope, scope))
    ) {
      queryClient.removeQueries({
        queryKey: watchingUpdatesQueryKey(previousScope),
        exact: true,
      });
    }
    previousScopeRef.current = scope;
  }, [queryClient, scope]);

  return useQuery({
    queryKey: watchingUpdatesQueryKey(queryScope),
    queryFn: async (): Promise<WatchingUpdate> => {
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
      const continueWatchingCount = 0;
      const newReleasesCount = 0;
      const updatedSeries: WatchingUpdate['updatedSeries'] = [];

      const updatePromises = candidates.map(async ({ follow, record }) => {
        try {
          const updateInfo = await checkSingleRecordUpdate(
            { follow, record },
            completionThreshold,
          );
          if (
            !updateInfo.hasNewEpisode ||
            !updateInfo.calculation ||
            !updateInfo.detail
          ) {
            return null;
          }
          const seriesInfo = mapWatchingUpdateItem({
            follow,
            record,
            detail: updateInfo.detail,
            calculation: updateInfo.calculation,
          });

          updatedSeries.push(seriesInfo);
          if (updateInfo.hasNewEpisode) updatedCount++;
          return seriesInfo;
        } catch (error) {
          console.error(`[追番更新] 检查${follow.title}更新失败:`, error);
          return null;
        }
      });

      await Promise.all(updatePromises);

      // 🔧 修复：对 updatedSeries 进行排序，确保每次顺序一致，防止卡片闪烁
      // 排序规则：
      // 1. 新上映的排在最前面
      // 2. 有新剧集的排在中间
      // 3. 需要继续观看的排在后面
      // 4. 相同类型按标题字母顺序排序
      updatedSeries.sort((a, b) => {
        // 优先级1: 新上映的排在最前面
        if (a.hasNewRelease !== b.hasNewRelease) {
          return a.hasNewRelease ? -1 : 1;
        }
        // 优先级2: 有新剧集的排在前面
        if (a.hasNewEpisode !== b.hasNewEpisode) {
          return a.hasNewEpisode ? -1 : 1;
        }
        // 优先级3: 需要继续观看的排在后面
        if (a.hasContinueWatching !== b.hasContinueWatching) {
          return a.hasContinueWatching ? -1 : 1;
        }
        // 优先级4: 按标题排序
        return a.title.localeCompare(b.title, 'zh-CN');
      });

      const hasUpdates = updatedCount > 0;

      console.log(
        `✅ [追番更新] 检查完成: ${hasUpdates ? `发现${newReleasesCount}部新上映，${updatedCount}部剧集有新集数更新，${continueWatchingCount}部剧集需要继续观看` : '暂无更新'}`,
      );

      const result = {
        hasUpdates,
        timestamp: Date.now(),
        updatedCount,
        continueWatchingCount,
        newReleasesCount,
        updatedSeries,
      };

      // 持久化到 localStorage（兼容旧实现的缓存机制）
      try {
        if (scope) {
          writeScopedWatchingUpdatesCache(scope, result);
          console.log('[追番更新] 结果已保存到 localStorage');
        }
      } catch (error) {
        console.warn('[追番更新] 保存到 localStorage 失败:', error);
      }

      return result;
    },
    // 30分钟缓存，避免频繁检查
    staleTime: options?.forceRefresh ? 0 : WATCHING_UPDATES_STALE_TIME,
    gcTime: 60 * 60 * 1000,
    // 30分钟自动刷新（后台定时检查）
    refetchInterval: 30 * 60 * 1000,
    // 只在窗口获得焦点时才自动刷新
    refetchIntervalInBackground: false,
    // 从 localStorage 读取初始数据（页面刷新后仍能显示）
    initialData: initialCache?.data,
    initialDataUpdatedAt: initialCache?.timestamp,
    // 只在启用时执行
    enabled: options?.enabled !== false && scope !== null,
    // 不自动重试，避免过多请求
    retry: false,
  });
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
