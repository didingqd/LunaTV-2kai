'use client';

/**
 * 继续观看排序选择 Hook
 *
 * 修改点：主页「继续观看」区块与用户菜单「继续观看」弹窗共用同一份排序偏好。
 * - 通过 useSyncExternalStore 订阅 localStorage 变化（任一处修改，另一处立即重排）
 * - selectType 交互与 APP MediaSortSheet 一致：
 *   点击当前字段切换升降序，点击新字段使用该字段的默认方向
 */

import { useCallback, useSyncExternalStore } from 'react';

import {
  continueWatchingSortDefaultAscending,
  type ContinueWatchingSortSelection,
  type ContinueWatchingSortType,
  DEFAULT_CONTINUE_WATCHING_SORT_SELECTION,
} from '@/lib/continue-watching-sort';
import {
  readContinueWatchingSortSelection,
  subscribeContinueWatchingSortSelection,
  writeContinueWatchingSortSelection,
} from '@/lib/continue-watching-sort-preference';

export function useContinueWatchingSortSelection() {
  const selection = useSyncExternalStore(
    subscribeContinueWatchingSortSelection,
    () => readContinueWatchingSortSelection(),
    () => DEFAULT_CONTINUE_WATCHING_SORT_SELECTION,
  );

  const setSelection = useCallback((next: ContinueWatchingSortSelection) => {
    writeContinueWatchingSortSelection(next);
  }, []);

  /** 点击排序字段：当前字段切换方向，新字段用默认方向（APP 同款交互） */
  const selectType = useCallback(
    (type: ContinueWatchingSortType) => {
      const ascending =
        selection.type === type
          ? !selection.ascending
          : continueWatchingSortDefaultAscending(type);
      writeContinueWatchingSortSelection({ type, ascending });
    },
    [selection.type, selection.ascending],
  );

  return { selection, setSelection, selectType };
}
