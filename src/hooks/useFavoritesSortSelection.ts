'use client';

/**
 * 收藏排序选择 Hook
 *
 * 修改点：为首页「收藏夹」Tab 提供与 APP MediaSortSheet 一致的排序偏好：
 * - 通过 useSyncExternalStore 订阅 localStorage 变化
 * - selectType 交互与 APP 一致：点击当前字段切换升降序，
 *   点击新字段使用该字段的默认方向
 * - 偏好持久化，切换页面/刷新后保持上次选择
 */

import { useCallback, useSyncExternalStore } from 'react';

import {
  DEFAULT_FAVORITES_SORT_SELECTION,
  favoritesSortDefaultAscending,
  type FavoritesSortSelection,
  type FavoritesSortType,
} from '@/lib/favorites-sort';
import {
  readFavoritesSortSelection,
  subscribeFavoritesSortSelection,
  writeFavoritesSortSelection,
} from '@/lib/favorites-sort-preference';

export function useFavoritesSortSelection() {
  const selection = useSyncExternalStore(
    subscribeFavoritesSortSelection,
    () => readFavoritesSortSelection(),
    () => DEFAULT_FAVORITES_SORT_SELECTION,
  );

  const setSelection = useCallback((next: FavoritesSortSelection) => {
    writeFavoritesSortSelection(next);
  }, []);

  /** 点击排序字段：当前字段切换方向，新字段用默认方向（APP 同款交互） */
  const selectType = useCallback(
    (type: FavoritesSortType) => {
      const ascending =
        selection.type === type
          ? !selection.ascending
          : favoritesSortDefaultAscending(type);
      writeFavoritesSortSelection({ type, ascending });
    },
    [selection.type, selection.ascending],
  );

  return { selection, setSelection, selectType };
}
