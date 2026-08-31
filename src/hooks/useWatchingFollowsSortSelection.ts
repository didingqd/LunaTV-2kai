'use client';

/**
 * 追更列表排序选择 Hook
 *
 * 修改点：为用户菜单「更新提醒 → 我的追更」列表提供与 APP MediaSortSheet
 * 一致的排序偏好：
 * - 通过 useSyncExternalStore 订阅 localStorage 变化
 * - selectType 交互与 APP 一致：点击当前字段切换升降序，
 *   点击新字段使用该字段的默认方向
 * - 偏好持久化，关闭弹窗/刷新后保持上次选择
 */

import { useCallback, useSyncExternalStore } from 'react';

import {
  DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION,
  watchingFollowsSortDefaultAscending,
  type WatchingFollowsSortSelection,
  type WatchingFollowsSortType,
} from '@/lib/watching-follows-sort';
import {
  readWatchingFollowsSortSelection,
  subscribeWatchingFollowsSortSelection,
  writeWatchingFollowsSortSelection,
} from '@/lib/watching-follows-sort-preference';

export function useWatchingFollowsSortSelection() {
  const selection = useSyncExternalStore(
    subscribeWatchingFollowsSortSelection,
    () => readWatchingFollowsSortSelection(),
    () => DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION,
  );

  const setSelection = useCallback((next: WatchingFollowsSortSelection) => {
    writeWatchingFollowsSortSelection(next);
  }, []);

  /** 点击排序字段：当前字段切换方向，新字段用默认方向（APP 同款交互） */
  const selectType = useCallback(
    (type: WatchingFollowsSortType) => {
      const ascending =
        selection.type === type
          ? !selection.ascending
          : watchingFollowsSortDefaultAscending(type);
      writeWatchingFollowsSortSelection({ type, ascending });
    },
    [selection.type, selection.ascending],
  );

  return { selection, setSelection, selectType };
}
