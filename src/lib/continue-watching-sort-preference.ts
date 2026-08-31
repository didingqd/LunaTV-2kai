/**
 * 继续观看排序偏好持久化
 *
 * 修改点：为「继续观看排序」提供 localStorage 读写与跨组件同步。
 * 模式与 watching-update-preference.ts 一致：写入时派发自定义事件，
 * 同窗口内的主页区块与用户菜单弹窗通过订阅实时感知排序变化，
 * 保证「弹窗里改排序 → 主页继续观看立即重排」。
 */

import {
  type ContinueWatchingSortSelection,
  continueWatchingSortSelectionFromStorageValue,
  continueWatchingSortStorageValue,
  DEFAULT_CONTINUE_WATCHING_SORT_SELECTION,
} from './continue-watching-sort';

export const CONTINUE_WATCHING_SORT_SELECTION_KEY =
  'moontv_continue_watching_sort_selection_v1';

const PREFERENCE_EVENT = 'moontv:continue-watching-sort-selection';

export function readContinueWatchingSortSelection(
  storage?: Pick<Storage, 'getItem'>,
): ContinueWatchingSortSelection {
  if (!storage && typeof window === 'undefined') {
    return DEFAULT_CONTINUE_WATCHING_SORT_SELECTION;
  }
  const value = (storage ?? window.localStorage).getItem(
    CONTINUE_WATCHING_SORT_SELECTION_KEY,
  );
  return resolveSelection(value);
}

// useSyncExternalStore 要求 getSnapshot 返回稳定引用：
// 这里按原始存储值缓存解析结果，值不变时始终返回同一个对象。
let selectionCache: {
  raw: string | null;
  selection: ContinueWatchingSortSelection;
} = { raw: null, selection: DEFAULT_CONTINUE_WATCHING_SORT_SELECTION };

function resolveSelection(value: string | null): ContinueWatchingSortSelection {
  if (selectionCache.raw === value) {
    return selectionCache.selection;
  }
  const selection = continueWatchingSortSelectionFromStorageValue(value);
  selectionCache = { raw: value, selection };
  return selection;
}

export function writeContinueWatchingSortSelection(
  selection: ContinueWatchingSortSelection,
  storage?: Pick<Storage, 'setItem'>,
): void {
  (storage ?? window.localStorage).setItem(
    CONTINUE_WATCHING_SORT_SELECTION_KEY,
    continueWatchingSortStorageValue(selection),
  );
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }
}

export function subscribeContinueWatchingSortSelection(
  listener: () => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONTINUE_WATCHING_SORT_SELECTION_KEY) listener();
  };
  window.addEventListener(PREFERENCE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
