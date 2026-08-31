'use client';

/**
 * 追更提醒排序选择 Hook
 *
 * 修改点：为用户菜单「更新提醒」Tab（新集更新区）提供与 APP MediaSortSheet
 * 一致的排序偏好：
 * - 通过 useSyncExternalStore 订阅 localStorage 变化
 * - selectType 交互与 APP 一致：点击当前字段切换升降序，
 *   点击新字段使用该字段的默认方向
 * - 偏好持久化，关闭弹窗/刷新后保持上次选择
 */

import { useCallback, useSyncExternalStore } from 'react';

import {
  DEFAULT_WATCHING_UPDATES_SORT_SELECTION,
  watchingUpdatesSortDefaultAscending,
  type WatchingUpdatesSortSelection,
  type WatchingUpdatesSortType,
} from '@/lib/watching-updates-sort';
import {
  readWatchingUpdatesSortSelection,
  subscribeWatchingUpdatesSortSelection,
  writeWatchingUpdatesSortSelection,
} from '@/lib/watching-updates-sort-preference';

export function useWatchingUpdatesSortSelection() {
  const selection = useSyncExternalStore(
    subscribeWatchingUpdatesSortSelection,
    () => readWatchingUpdatesSortSelection(),
    () => DEFAULT_WATCHING_UPDATES_SORT_SELECTION,
  );

  const setSelection = useCallback((next: WatchingUpdatesSortSelection) => {
    writeWatchingUpdatesSortSelection(next);
  }, []);

  /** 点击排序字段：当前字段切换方向，新字段用默认方向（APP 同款交互） */
  const selectType = useCallback(
    (type: WatchingUpdatesSortType) => {
      const ascending =
        selection.type === type
          ? !selection.ascending
          : watchingUpdatesSortDefaultAscending(type);
      writeWatchingUpdatesSortSelection({ type, ascending });
    },
    [selection.type, selection.ascending],
  );

  return { selection, setSelection, selectType };
}
