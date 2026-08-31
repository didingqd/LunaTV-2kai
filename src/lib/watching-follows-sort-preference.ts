/**
 * 追更列表排序偏好持久化
 *
 * 修改点：为「追更列表排序」提供 localStorage 读写与跨组件同步。
 * 模式与 favorites-sort-preference.ts 一致：写入时派发自定义事件，
 * 同窗口内订阅方实时感知排序变化（当前消费方为用户菜单「我的追更」Tab）。
 */

import {
  DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION,
  type WatchingFollowsSortSelection,
  watchingFollowsSortSelectionFromStorageValue,
  watchingFollowsSortStorageValue,
} from './watching-follows-sort';

export const WATCHING_FOLLOWS_SORT_SELECTION_KEY =
  'moontv_watching_follows_sort_selection_v1';

const PREFERENCE_EVENT = 'moontv:watching-follows-sort-selection';

export function readWatchingFollowsSortSelection(
  storage?: Pick<Storage, 'getItem'>,
): WatchingFollowsSortSelection {
  if (!storage && typeof window === 'undefined') {
    return DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION;
  }
  const value = (storage ?? window.localStorage).getItem(
    WATCHING_FOLLOWS_SORT_SELECTION_KEY,
  );
  return resolveSelection(value);
}

// useSyncExternalStore 要求 getSnapshot 返回稳定引用：
// 这里按原始存储值缓存解析结果，值不变时始终返回同一个对象。
let selectionCache: {
  raw: string | null;
  selection: WatchingFollowsSortSelection;
} = { raw: null, selection: DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION };

function resolveSelection(value: string | null): WatchingFollowsSortSelection {
  if (selectionCache.raw === value) {
    return selectionCache.selection;
  }
  const selection = watchingFollowsSortSelectionFromStorageValue(value);
  selectionCache = { raw: value, selection };
  return selection;
}

export function writeWatchingFollowsSortSelection(
  selection: WatchingFollowsSortSelection,
  storage?: Pick<Storage, 'setItem'>,
): void {
  (storage ?? window.localStorage).setItem(
    WATCHING_FOLLOWS_SORT_SELECTION_KEY,
    watchingFollowsSortStorageValue(selection),
  );
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }
}

export function subscribeWatchingFollowsSortSelection(
  listener: () => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === WATCHING_FOLLOWS_SORT_SELECTION_KEY) listener();
  };
  window.addEventListener(PREFERENCE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
