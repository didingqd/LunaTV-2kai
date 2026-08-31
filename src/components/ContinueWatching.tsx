'use client';

import { ArrowUpDown, Clock, Trash2 } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  compareContentIdentity,
  resolveContentIdentity,
} from '@/lib/content-identity';
import {
  continueWatchingSortLabel,
  sortContinueWatchingRecords,
} from '@/lib/continue-watching-sort';
import type { PlayRecord } from '@/lib/db.client';
// 🚀 TanStack Query Queries
import {
  useContinueWatchingQuery,
  useWatchingUpdatesQuery,
} from '@/hooks/useContinueWatchingQueries';
// 🚀 修改点：继续观看排序（与 APP 同款），与用户菜单弹窗共享同一偏好
import { useContinueWatchingSortSelection } from '@/hooks/useContinueWatchingSortSelection';
// 🚀 TanStack Query Mutations
import { useClearPlayRecordsMutation } from '@/hooks/usePlayRecordsMutations';
import {
  getWatchingFollowBaselineMenuState,
  useWatchingFollows,
} from '@/hooks/useWatchingFollows';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import ContinueWatchingSortPanel from '@/components/ContinueWatchingSortPanel';
import ScrollableRow from '@/components/ScrollableRow';
import SectionTitle from '@/components/SectionTitle';
import VideoCard from '@/components/VideoCard';

interface ContinueWatchingProps {
  className?: string;
}

// 🚀 优化方案6：使用React.memo防止不必要的重渲染
function ContinueWatching({ className }: ContinueWatchingProps) {
  // 修改点：读取清空确认设置从 useEffect+setState 改为惰性初始化
  // （该值仅在点击回调中使用，不影响渲染输出，无 hydration 风险；
  //   原实现中 setter 除初始化外从未被调用，因此不再保留）
  const [requireClearConfirmation] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const savedRequireClearConfirmation = localStorage.getItem(
      'requireClearConfirmation',
    );
    return savedRequireClearConfirmation !== null
      ? JSON.parse(savedRequireClearConfirmation)
      : false;
  });
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // 🚀 TanStack Query - 播放记录
  const { data: playRecords = [], isLoading: loading } =
    useContinueWatchingQuery();

  // 🚀 TanStack Query - 观看更新（仅当有播放记录时才查询）
  const { data: watchingUpdates = null } = useWatchingUpdatesQuery({
    enabled: !loading && playRecords.length > 0,
  });

  // 🚀 修改点：继续观看排序（与 APP 同款）
  // 与用户菜单「继续观看」弹窗共享同一排序偏好，任一处修改，主页立即重排。
  // 默认排序（最近观看 = save_time 降序）与原有行为完全一致。
  const [isSortPanelOpen, setIsSortPanelOpen] = useState(false);
  const { selection: sortSelection, selectType: selectSortType } =
    useContinueWatchingSortSelection();
  const sortedPlayRecords = useMemo(
    () =>
      sortContinueWatchingRecords(
        playRecords,
        sortSelection,
        watchingUpdates?.updatedSeries,
      ),
    [playRecords, sortSelection, watchingUpdates],
  );
  const {
    follows,
    isFollowing,
    createFollow,
    deleteFollow,
    confirmWatchedToLatest,
    isFollowPending,
    isStateKnown: isFollowStateKnown,
  } = useWatchingFollows();

  // 🚀 TanStack Query - 使用 useMutation 管理清空播放记录操作
  const clearPlayRecordsMutation = useClearPlayRecordsMutation();

  // 如果没有播放记录，则不渲染组件
  if (!loading && playRecords.length === 0) {
    return null;
  }

  // 计算播放进度百分比
  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  // 从 key 中解析 source 和 id
  const parseKey = (key: string) => {
    return resolveContentIdentity(key) ?? { source: key, id: '' };
  };

  // 检查播放记录是否有新集数更新
  const getNewEpisodesCount = (
    record: PlayRecord & { key: string },
  ): number => {
    if (!watchingUpdates || !watchingUpdates.updatedSeries) return 0;

    const { source, id } = parseKey(record.key);

    // 在watchingUpdates中查找匹配的剧集
    const matchedSeries = watchingUpdates.updatedSeries.find(
      (series) =>
        series.hasNewEpisode && compareContentIdentity(series, { source, id }),
    );

    return matchedSeries ? matchedSeries.newEpisodes || 0 : 0;
  };

  // 获取最新的总集数（用于显示，不修改原始数据）
  const getLatestTotalEpisodes = (
    record: PlayRecord & { key: string },
  ): number => {
    if (!watchingUpdates || !watchingUpdates.updatedSeries)
      return record.total_episodes;

    const { source, id } = parseKey(record.key);

    // 在watchingUpdates中查找匹配的剧集
    const matchedSeries = watchingUpdates.updatedSeries.find((series) =>
      compareContentIdentity(series, { source, id }),
    );

    // 如果找到匹配的剧集且有最新集数信息，返回最新集数（使用 latestEpisodes，包含了 protectedTotalEpisodes）
    return matchedSeries && matchedSeries.latestEpisodes
      ? matchedSeries.latestEpisodes
      : record.total_episodes;
  };

  const handleToggleFollow = async (record: PlayRecord & { key: string }) => {
    const { source, id } = parseKey(record.key);
    if (!source || !id) return;

    if (isFollowing(source, id)) {
      await deleteFollow(source, id);
      toast.success('已取消加追');
      return;
    }

    const response = await fetch(
      `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error('详情获取失败，无法建立追更基线');
    const detail = await response.json();
    const originalEpisodes = Array.isArray(detail.episodes)
      ? detail.episodes.length
      : 0;
    if (originalEpisodes <= 0) {
      throw new Error('详情缺少有效剧集信息');
    }

    await createFollow({
      source,
      id,
      title: detail.title || record.title,
      cover: detail.poster || record.cover,
      year: String(detail.year || record.year || ''),
      type:
        detail.type_name || record.type || (originalEpisodes > 1 ? 'tv' : ''),
      originalEpisodes,
    });
    toast.success('已加追');
  };

  const handleMarkWatchedToLatest = async (
    record: PlayRecord & { key: string },
  ) => {
    const { source, id } = parseKey(record.key);
    if (!source || !id) return;

    const matchedSeries = watchingUpdates?.updatedSeries?.find((series) =>
      compareContentIdentity(series, { source, id }),
    );
    let latestEpisodes = matchedSeries?.latestEpisodes || 0;
    if (latestEpisodes <= 0) {
      const response = await fetch(
        `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('详情获取失败，无法确认最新集数');
      const detail = await response.json();
      latestEpisodes = Array.isArray(detail.episodes)
        ? detail.episodes.length
        : 0;
    }
    if (latestEpisodes <= 0) throw new Error('详情缺少有效剧集信息');

    // Manual confirmation advances only the WatchingFollow baseline. It does
    // not update this PlayRecord, so Continue Watching keeps the saved episode
    // while update badges disappear through the shared Watching Updates cache.
    await confirmWatchedToLatest(source, id, latestEpisodes);
    toast.success('已确认观看至最新');
  };

  // 处理清空所有记录
  const handleClearAll = () => {
    // 🚀 使用 mutation.mutate() 清空播放记录
    // 特性：立即清空 UI（乐观更新），失败时自动回滚
    clearPlayRecordsMutation.mutate();
    setShowConfirmDialog(false);
  };

  return (
    <section className={`mb-8 ${className || ''}`}>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle
          title='继续观看'
          icon={Clock}
          iconColor='text-green-500'
        />
        {!loading && playRecords.length > 0 && (
          <div className='flex items-center gap-2'>
            {/* 修改点：排序按钮（与 APP 同款排序），与用户菜单弹窗共享排序偏好 */}
            <button
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-500 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
              onClick={() => setIsSortPanelOpen(true)}
            >
              <ArrowUpDown className='w-4 h-4' />
              <span className='hidden sm:inline'>
                {continueWatchingSortLabel(sortSelection.type)}
              </span>
            </button>
            <button
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-white hover:bg-red-600 dark:text-red-400 dark:hover:text-white dark:hover:bg-red-500 border border-red-300 dark:border-red-700 hover:border-red-600 dark:hover:border-red-500 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
              onClick={() => {
                // 根据用户设置决定是否显示确认对话框
                if (requireClearConfirmation) {
                  setShowConfirmDialog(true);
                } else {
                  handleClearAll();
                }
              }}
            >
              <Trash2 className='w-4 h-4' />
              <span>清空</span>
            </button>
          </div>
        )}
      </div>

      {/* 确认对话框 */}
      <ConfirmDialog
        isOpen={showConfirmDialog}
        title='确认清空'
        message={`确定要清空所有继续观看记录吗？\n\n这将删除 ${playRecords.length} 条播放记录，此操作无法撤销。`}
        confirmText='确认清空'
        cancelText='取消'
        variant='danger'
        onConfirm={handleClearAll}
        onCancel={() => setShowConfirmDialog(false)}
      />
      {/* 修改点：排序设置面板（与 APP 同款） */}
      <ContinueWatchingSortPanel
        isOpen={isSortPanelOpen}
        selection={sortSelection}
        onSelect={selectSortType}
        onClose={() => setIsSortPanelOpen(false)}
      />
      <ScrollableRow>
        {loading
          ? // 加载状态显示灰色占位数据
            Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
              >
                <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                  <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                </div>
                <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                <div className='mt-1 h-3 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
              </div>
            ))
          : // 显示真实数据（修改点：按共享排序偏好排序后的记录）
            sortedPlayRecords.map((record, index) => {
              const { source, id } = parseKey(record.key);
              const newEpisodesCount = getNewEpisodesCount(record);
              const latestTotalEpisodes = getLatestTotalEpisodes(record);
              const followBaselineMenuState =
                getWatchingFollowBaselineMenuState(
                  follows,
                  source,
                  id,
                  latestTotalEpisodes,
                );
              // 优先使用播放记录中保存的 type，否则根据集数判断
              const cardType =
                record.type || (latestTotalEpisodes > 1 ? 'tv' : '');
              return (
                <div
                  key={record.key}
                  className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44 relative group/card'
                >
                  <div className='relative group-hover/card:z-5 transition-all duration-300'>
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      episodes={latestTotalEpisodes}
                      currentEpisode={record.index}
                      query={record.search_title}
                      from='playrecord'
                      type={cardType}
                      remarks={record.remarks}
                      priority={index < 4}
                      douban_id={record.douban_id}
                      following={
                        isFollowStateKnown ? isFollowing(source, id) : false
                      }
                      followLoading={
                        !isFollowStateKnown || isFollowPending(source, id)
                      }
                      onToggleFollow={
                        isFollowStateKnown
                          ? () => {
                              void handleToggleFollow(record).catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : '追更操作失败',
                                ),
                              );
                            }
                          : undefined
                      }
                      markWatchedToLatestAction={
                        followBaselineMenuState
                          ? {
                              title: followBaselineMenuState.title,
                              isAlreadyAtLatest:
                                followBaselineMenuState.isAlreadyAtLatest,
                              onClick: () => {
                                void handleMarkWatchedToLatest(record).catch(
                                  (error) =>
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : '确认失败',
                                    ),
                                );
                              },
                            }
                          : undefined
                      }
                    />
                  </div>
                  {/* 新集数徽章 - Netflix 统一风格 */}
                  {newEpisodesCount > 0 && (
                    <div className='absolute -top-2 -right-2 bg-red-600 text-white text-xs px-2 py-0.5 rounded-md shadow-lg animate-pulse z-10 font-bold'>
                      +{newEpisodesCount}
                    </div>
                  )}
                </div>
              );
            })}
      </ScrollableRow>
    </section>
  );
}

export default memo(ContinueWatching);
