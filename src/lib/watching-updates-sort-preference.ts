/**
 * 追更提醒排序偏好持久化
 *
 * 修改点：为「追更提醒排序」提供 localStorage 读写与跨组件同步。
 * 模式与 favorites-sort-preference.ts 一致：写入时派发自定义事件，
 * 同窗口内订阅方实时感知排序变化（当前消费方为用户菜单「更新提醒」Tab）。
 */

import {
  DEFAULT_WATCHING_UPDATES_SORT_SELECTION,
  type WatchingUpdatesSortSelection,
  watchingUpdatesSortSelectionFromStorageValue,
  watchingUpdatesSortStorageValue,
} from './watching-updates-sort';

export const WATCHING_UPDATES_SORT_SELECTION_KEY =
  'moontv_watching_updates_sort_selection_v1';

const PREFERENCE_EVENT = 'moontv:watching-updates-sort-selection';

export function readWatchingUpdatesSortSelection(
  storage?: Pick<Storage, 'getItem'>,
): WatchingUpdatesSortSelection {
  if (!storage && typeof window === 'undefined') {
    return DEFAULT_WATCHING_UPDATES_SORT_SELECTION;
  }
  const value = (storage ?? window.localStorage).getItem(
    WATCHING_UPDATES_SORT_SELECTION_KEY,
  );
  return resolveSelection(value);
}

// useSyncExternalStore 要求 getSnapshot 返回稳定引用：
// 这里按原始存储值缓存解析结果，值不变时始终返回同一个对象。
let selectionCache: {
  raw: string | null;
  selection: WatchingUpdatesSortSelection;
} = { raw: null, selection: DEFAULT_WATCHING_UPDATES_SORT_SELECTION };

function resolveSelection(value: string | null): WatchingUpdatesSortSelection {
  if (selectionCache.raw === value) {
    return selectionCache.selection;
  }
  const selection = watchingUpdatesSortSelectionFromStorageValue(value);
  selectionCache = { raw: value, selection };
  return selection;
}

export function writeWatchingUpdatesSortSelection(
  selection: WatchingUpdatesSortSelection,
  storage?: Pick<Storage, 'setItem'>,
): void {
  (storage ?? window.localStorage).setItem(
    WATCHING_UPDATES_SORT_SELECTION_KEY,
    watchingUpdatesSortStorageValue(selection),
  );
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }
}

export function subscribeWatchingUpdatesSortSelection(
  listener: () => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === WATCHING_UPDATES_SORT_SELECTION_KEY) listener();
  };
  window.addEventListener(PREFERENCE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
