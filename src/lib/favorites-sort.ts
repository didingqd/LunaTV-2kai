/**
 * 收藏排序 —— 与 APP（Selene-Source）favorites_screen 同款排序逻辑
 *
 * 修改点：为 Web 端「收藏夹」补齐与 APP 一致的排序能力：
 * - 十种排序：保存时间（默认）/ 最近观看 / 更新集数 / 更新时间 / 观看进度 /
 *   剩余时间 / 名称 / 资源 / 年份 / 上映时间（顺序与 APP supportedSorts 一致）
 * - 与 APP MediaSortEngine 相同的语义：
 *   - null 恒排最后（两个方向都一致），「更新集数」排序下无更新（0 集）映射为 null，
 *     因此有更新的收藏恒在无更新之前；
 *   - 「更新集数 / 更新时间」排序主值相等时，次级排序固定降序
 *     （更新集数：先更新时间新的在前，再保存时间从新到旧；更新时间同理互换），
 *     其余排序主值相等时维持基线顺序（保存时间从新到旧）。
 * - 存储值字符串（type:asc|desc）与 APP MediaSortPreferenceService 通用格式一致
 */

import {
  buildUpdateInfoMap,
  compareSortValues,
  type UpdateSortInfo,
} from './continue-watching-sort';
import type { WatchingUpdateItem } from './watching-update-result';

// ============================================================================
// 类型定义
// ============================================================================

export type FavoritesSortType =
  | 'savedAt' // 保存时间（默认）
  | 'lastWatchedAt' // 最近观看
  | 'newEpisodeCount' // 更新集数（无更新恒在后）
  | 'updateDetectedAt' // 更新时间（无更新恒在后）
  | 'watchProgress' // 观看进度
  | 'remainingTime' // 剩余时间
  | 'title' // 名称
  | 'source' // 资源（先资源名后名称）
  | 'year' // 年份
  | 'releaseDate'; // 上映时间

export interface FavoritesSortSelection {
  type: FavoritesSortType;
  ascending: boolean;
}

/** 收藏排序输入项（由调用方从收藏数据 + 播放记录装配） */
export interface FavoritesSortItem {
  /** 内容身份 key（用于匹配追更检测结果，见 content-identity） */
  identityKey: string;
  title: string;
  sourceName?: string | null;
  year?: string | null;
  releaseDate?: string | null;
  /** 收藏保存时间（毫秒时间戳） */
  saveTime?: number | null;
  /** 对应播放记录的最近观看时间（无播放记录为 null） */
  lastWatchedAt?: number | null;
  /** 观看进度（0-1；无播放记录或总时长未知为 null） */
  watchProgress?: number | null;
  /** 剩余观看时间（秒；无播放记录或总时长未知为 null） */
  remainingTime?: number | null;
}

// ============================================================================
// 选项元数据（顺序与 APP favorites_screen 的 supportedSorts 一致）
// ============================================================================

export const FAVORITES_SORT_OPTIONS: readonly FavoritesSortType[] = [
  'savedAt',
  'lastWatchedAt',
  'newEpisodeCount',
  'updateDetectedAt',
  'watchProgress',
  'remainingTime',
  'title',
  'source',
  'year',
  'releaseDate',
];

/** APP 同款默认排序：保存时间降序（即 Web 原有的「最近添加」） */
export const DEFAULT_FAVORITES_SORT_SELECTION: FavoritesSortSelection = {
  type: 'savedAt',
  ascending: false,
};

/** 各排序字段的中文名称（与 APP MediaSortTypePresentation.label 一致） */
export function favoritesSortLabel(type: FavoritesSortType): string {
  switch (type) {
    case 'savedAt':
      return '保存时间';
    case 'lastWatchedAt':
      return '最近观看';
    case 'newEpisodeCount':
      return '更新集数';
    case 'updateDetectedAt':
      return '更新时间';
    case 'watchProgress':
      return '观看进度';
    case 'remainingTime':
      return '剩余时间';
    case 'title':
      return '名称';
    case 'source':
      return '资源';
    case 'year':
      return '年份';
    case 'releaseDate':
      return '上映时间';
  }
}

/** 选择新字段时使用的默认方向（与 APP MediaSortType.defaultAscending 一致） */
export function favoritesSortDefaultAscending(
  type: FavoritesSortType,
): boolean {
  return type === 'title' || type === 'source';
}

/** 方向文案（与 APP MediaSortTypePresentation.directionLabel 一致） */
export function favoritesSortDirectionLabel(
  type: FavoritesSortType,
  ascending: boolean,
): string {
  switch (type) {
    case 'title':
    case 'source':
      return ascending ? '从A到Z' : '从Z到A';
    case 'savedAt':
      return ascending ? '最早保存' : '最近保存';
    case 'lastWatchedAt':
      return ascending ? '最早观看' : '最近观看';
    case 'newEpisodeCount':
      return ascending ? '从少到多' : '从多到少';
    case 'updateDetectedAt':
      return ascending ? '新加入在后' : '新加入在前';
    case 'watchProgress':
      return ascending ? '进度低在前' : '进度高在前';
    case 'remainingTime':
      return ascending ? '从少到多' : '从多到少';
    case 'year':
    case 'releaseDate':
      return ascending ? '从旧到新' : '从新到旧';
  }
}

// ============================================================================
// 偏好持久化值（字符串格式与 APP MediaSortPreferenceService 通用格式一致）
// ============================================================================

export function favoritesSortStorageValue(
  selection: FavoritesSortSelection,
): string {
  return `${selection.type}:${selection.ascending ? 'asc' : 'desc'}`;
}

export function favoritesSortSelectionFromStorageValue(
  value: string | null | undefined,
): FavoritesSortSelection {
  if (value == null) return DEFAULT_FAVORITES_SORT_SELECTION;
  const parts = value.split(':');
  if (parts.length !== 2) return DEFAULT_FAVORITES_SORT_SELECTION;
  const [typeName, direction] = parts;
  if (
    typeName !== 'savedAt' &&
    typeName !== 'lastWatchedAt' &&
    typeName !== 'newEpisodeCount' &&
    typeName !== 'updateDetectedAt' &&
    typeName !== 'watchProgress' &&
    typeName !== 'remainingTime' &&
    typeName !== 'title' &&
    typeName !== 'source' &&
    typeName !== 'year' &&
    typeName !== 'releaseDate'
  ) {
    return DEFAULT_FAVORITES_SORT_SELECTION;
  }
  if (direction !== 'asc' && direction !== 'desc') {
    return DEFAULT_FAVORITES_SORT_SELECTION;
  }
  return { type: typeName, ascending: direction === 'asc' };
}

// ============================================================================
// 排序实现（还原 APP MediaSortEngine.sort + favorites_screen 的取值与兜底声明）
// ============================================================================

/** 主排序值：复合值（如「资源」= [资源名, 名称]）逐项比较，null 恒最后 */
type SortValue = number | string | readonly (number | string | null)[];

interface IndexedItem<T> {
  item: T;
  /** 基线顺序（保存时间降序）中的下标，用于稳定兜底 */
  baselineIndex: number;
  value: SortValue | null;
  tieBreakValue: number | null;
}

/**
 * 对收藏列表排序。
 *
 * @param items 收藏项（任意顺序，内部先收敛到基线排序：保存时间降序）
 * @param selection 排序选择
 * @param updatedSeries 追更检测结果（用于「更新集数 / 更新时间」排序）
 */
export function sortFavorites<T extends FavoritesSortItem>(
  items: readonly T[],
  selection: FavoritesSortSelection,
  updatedSeries?: readonly WatchingUpdateItem[] | null,
): T[] {
  const updateInfoMap = buildUpdateInfoMap(updatedSeries);
  // 基线排序：保存时间降序（与原 Web 端「最近添加」一致），null 恒最后
  const baseline = items
    .map((item, index) => ({ item, sourceIndex: index }))
    .sort((left, right) => {
      const leftTime = left.item.saveTime;
      const rightTime = right.item.saveTime;
      if (leftTime == null && rightTime == null) {
        return left.sourceIndex - right.sourceIndex;
      }
      if (leftTime == null) return 1;
      if (rightTime == null) return -1;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.sourceIndex - right.sourceIndex;
    })
    .map((entry, index) => ({
      item: entry.item,
      baselineIndex: index,
      value: extractFavoritesSortValue(
        entry.item,
        selection.type,
        updateInfoMap,
      ),
      tieBreakValue: extractFavoritesTieBreakValue(
        entry.item,
        selection.type,
        updateInfoMap,
      ),
    }));

  return baseline
    .sort((left, right) => {
      if (left.value == null && right.value == null) {
        return compareTieBreak(left, right);
      }
      if (left.value == null) return 1;
      if (right.value == null) return -1;
      const comparison = compareValues(left.value, right.value);
      if (comparison !== 0) {
        return selection.ascending ? comparison : -comparison;
      }
      // 主排序值相等（含批量检测共享同一检测时间等场景）时走次级排序
      return compareTieBreak(left, right);
    })
    .map(({ item }) => item);
}

/**
 * 主排序字段取值（与 APP favorites_screen._sortValueOf 对应）。
 * 「更新集数」把无更新（0 集）映射为 null，配合 null-last 语义，
 * 保证有更新的收藏恒在无更新之前（升降序都成立）。
 */
function extractFavoritesSortValue(
  item: FavoritesSortItem,
  type: FavoritesSortType,
  updateInfoMap: Map<string, UpdateSortInfo>,
): SortValue | null {
  const updateInfo = updateInfoMap.get(item.identityKey);
  switch (type) {
    case 'savedAt':
      return item.saveTime ?? null;
    case 'lastWatchedAt':
      return item.lastWatchedAt ?? null;
    case 'newEpisodeCount':
      return updateInfo && updateInfo.newEpisodes > 0
        ? updateInfo.newEpisodes
        : null;
    case 'updateDetectedAt':
      return updateInfo?.detectedAt ?? null;
    case 'watchProgress':
      return item.watchProgress ?? null;
    case 'remainingTime':
      return item.remainingTime ?? null;
    case 'title':
      return item.title;
    case 'source':
      // APP 同款复合值：先资源名后名称
      return [item.sourceName ?? '', item.title];
    case 'year': {
      const parsed = Number.parseInt(String(item.year ?? '').trim(), 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    case 'releaseDate':
      return item.releaseDate ?? null;
  }
}

/**
 * 次级排序取值（与 APP _sortTieBreakValueOfFavorite 对应，方向固定降序）：
 * - 更新集数：主值相等时先按更新时间新的在前，再按保存时间从新到旧；
 * - 更新时间：主值相等时先按更新集数多的在前，再按保存时间从新到旧；
 * - 其余排序返回 null（保持「相等时维持基线顺序」的原有行为）。
 * 保存时间兜底由 baselineIndex（基线=保存时间降序）承担。
 */
function extractFavoritesTieBreakValue(
  item: FavoritesSortItem,
  type: FavoritesSortType,
  updateInfoMap: Map<string, UpdateSortInfo>,
): number | null {
  const updateInfo = updateInfoMap.get(item.identityKey);
  switch (type) {
    case 'newEpisodeCount':
      return updateInfo?.detectedAt ?? null;
    case 'updateDetectedAt':
      return updateInfo && updateInfo.newEpisodes > 0
        ? updateInfo.newEpisodes
        : null;
    default:
      return null;
  }
}

/** 次级排序比较：方向固定降序、null 恒最后，之后回落基线顺序（保存时间降序） */
function compareTieBreak<T>(
  left: IndexedItem<T>,
  right: IndexedItem<T>,
): number {
  if (left.tieBreakValue != null && right.tieBreakValue != null) {
    const comparison = right.tieBreakValue - left.tieBreakValue;
    if (comparison !== 0) return comparison;
  } else if (left.tieBreakValue != null) {
    return -1;
  } else if (right.tieBreakValue != null) {
    return 1;
  }
  return left.baselineIndex - right.baselineIndex;
}

/** 数值直接比较；字符串使用中文拼音感知排序；复合值逐项比较 */
function compareValues(left: SortValue, right: SortValue): number {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftValues = Array.isArray(left) ? left : [left];
    const rightValues = Array.isArray(right) ? right : [right];
    const sharedLength = Math.min(leftValues.length, rightValues.length);
    for (let index = 0; index < sharedLength; index++) {
      const leftValue = leftValues[index];
      const rightValue = rightValues[index];
      if (leftValue == null && rightValue == null) continue;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      const comparison = compareSortValues(leftValue, rightValue);
      if (comparison !== 0) return comparison;
    }
    return leftValues.length - rightValues.length;
  }
  // Array.isArray 对 readonly 数组的类型窄化不可靠，此处显式断言为标量
  return compareSortValues(left as number | string, right as number | string);
}
