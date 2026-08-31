/**
 * 收藏排序偏好持久化
 *
 * 修改点：为「收藏夹排序」提供 localStorage 读写与跨组件同步。
 * 模式与 continue-watching-sort-preference.ts 一致：写入时派发自定义事件，
 * 同窗口内订阅方实时感知排序变化（当前消费方为首页收藏夹 Tab，
 * 将来若用户菜单收藏弹窗接入同一排序可零成本共享）。
 */

import {
  DEFAULT_FAVORITES_SORT_SELECTION,
  type FavoritesSortSelection,
  favoritesSortSelectionFromStorageValue,
  favoritesSortStorageValue,
} from './favorites-sort';

export const FAVORITES_SORT_SELECTION_KEY =
  'moontv_favorites_sort_selection_v1';

const PREFERENCE_EVENT = 'moontv:favorites-sort-selection';

export function readFavoritesSortSelection(
  storage?: Pick<Storage, 'getItem'>,
): FavoritesSortSelection {
  if (!storage && typeof window === 'undefined') {
    return DEFAULT_FAVORITES_SORT_SELECTION;
  }
  const value = (storage ?? window.localStorage).getItem(
    FAVORITES_SORT_SELECTION_KEY,
  );
  return resolveSelection(value);
}

// useSyncExternalStore 要求 getSnapshot 返回稳定引用：
// 这里按原始存储值缓存解析结果，值不变时始终返回同一个对象。
let selectionCache: {
  raw: string | null;
  selection: FavoritesSortSelection;
} = { raw: null, selection: DEFAULT_FAVORITES_SORT_SELECTION };

function resolveSelection(value: string | null): FavoritesSortSelection {
  if (selectionCache.raw === value) {
    return selectionCache.selection;
  }
  const selection = favoritesSortSelectionFromStorageValue(value);
  selectionCache = { raw: value, selection };
  return selection;
}

export function writeFavoritesSortSelection(
  selection: FavoritesSortSelection,
  storage?: Pick<Storage, 'setItem'>,
): void {
  (storage ?? window.localStorage).setItem(
    FAVORITES_SORT_SELECTION_KEY,
    favoritesSortStorageValue(selection),
  );
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }
}

export function subscribeFavoritesSortSelection(
  listener: () => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === FAVORITES_SORT_SELECTION_KEY) listener();
  };
  window.addEventListener(PREFERENCE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
