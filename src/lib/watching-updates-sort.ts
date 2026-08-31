/**
 * 追更提醒排序 —— 与 APP（Selene-Source）UpdateReminderScreen / WatchingUpdateSorter 同款逻辑
 *
 * 修改点：为 Web 端用户菜单「更新提醒」弹窗的「更新提醒」Tab（新集更新区）补齐
 * 与 APP 一致的排序能力：
 * - 四种排序：名称 / 更新集数 / 更新时间（默认）/ 资源
 *   （顺序与 APP UpdateReminderScreen supportedSorts 一致）
 * - 与 APP MediaSortEngine 相同的语义：
 *   - null 恒排最后；本列表只包含 hasNewEpisode 的项（调用方已过滤），
 *     但「更新时间」排序下检测时间缺失仍为 null 恒在后；
 *   - 「更新集数 / 更新时间」排序主值相等时，次级排序固定降序
 *     （更新集数：先更新时间新的在前；更新时间：先更新集数多的在前），
 *     相等再回落基线顺序（更新时间从新到旧，即 Web 原有展示顺序）。
 * - 存储值字符串（type:asc|desc）与 APP MediaSortPreferenceService 通用格式一致，
 *   localStorage 键独立（watching-updates 前缀对应 APP keyPrefix）
 */

import { compareSortValues } from './continue-watching-sort';
import type { WatchingUpdateItem } from './watching-update-result';

// ============================================================================
// 类型定义
// ============================================================================

export type WatchingUpdatesSortType =
  | 'title' // 名称
  | 'newEpisodeCount' // 更新集数
  | 'updateDetectedAt' // 更新时间（默认）
  | 'source'; // 资源（先资源名后名称）

export interface WatchingUpdatesSortSelection {
  type: WatchingUpdatesSortType;
  ascending: boolean;
}

// ============================================================================
// 选项元数据（顺序与 APP UpdateReminderScreen 的 supportedSorts 一致）
// ============================================================================

export const WATCHING_UPDATES_SORT_OPTIONS: readonly WatchingUpdatesSortType[] =
  ['title', 'newEpisodeCount', 'updateDetectedAt', 'source'];

/** APP 同款默认排序：更新时间降序（新加入在前，与 Web 原有展示顺序一致） */
export const DEFAULT_WATCHING_UPDATES_SORT_SELECTION: WatchingUpdatesSortSelection =
  { type: 'updateDetectedAt', ascending: false };

/** 各排序字段的中文名称（与 APP MediaSortTypePresentation.label 一致） */
export function watchingUpdatesSortLabel(
  type: WatchingUpdatesSortType,
): string {
  switch (type) {
    case 'title':
      return '名称';
    case 'newEpisodeCount':
      return '更新集数';
    case 'updateDetectedAt':
      return '更新时间';
    case 'source':
      return '资源';
  }
}

/** 选择新字段时使用的默认方向（与 APP MediaSortType.defaultAscending 一致） */
export function watchingUpdatesSortDefaultAscending(
  type: WatchingUpdatesSortType,
): boolean {
  return type === 'title' || type === 'source';
}

/** 方向文案（与 APP MediaSortTypePresentation.directionLabel 一致） */
export function watchingUpdatesSortDirectionLabel(
  type: WatchingUpdatesSortType,
  ascending: boolean,
): string {
  switch (type) {
    case 'title':
    case 'source':
      return ascending ? '从A到Z' : '从Z到A';
    case 'newEpisodeCount':
      return ascending ? '从少到多' : '从多到少';
    case 'updateDetectedAt':
      return ascending ? '新加入在后' : '新加入在前';
  }
}

// ============================================================================
// 偏好持久化值（字符串格式与 APP MediaSortPreferenceService 通用格式一致）
// ============================================================================

export function watchingUpdatesSortStorageValue(
  selection: WatchingUpdatesSortSelection,
): string {
  return `${selection.type}:${selection.ascending ? 'asc' : 'desc'}`;
}

export function watchingUpdatesSortSelectionFromStorageValue(
  value: string | null | undefined,
): WatchingUpdatesSortSelection {
  if (value == null) return DEFAULT_WATCHING_UPDATES_SORT_SELECTION;
  const parts = value.split(':');
  if (parts.length !== 2) return DEFAULT_WATCHING_UPDATES_SORT_SELECTION;
  const [typeName, direction] = parts;
  if (
    typeName !== 'title' &&
    typeName !== 'newEpisodeCount' &&
    typeName !== 'updateDetectedAt' &&
    typeName !== 'source'
  ) {
    return DEFAULT_WATCHING_UPDATES_SORT_SELECTION;
  }
  if (direction !== 'asc' && direction !== 'desc') {
    return DEFAULT_WATCHING_UPDATES_SORT_SELECTION;
  }
  return { type: typeName, ascending: direction === 'asc' };
}

// ============================================================================
// 排序实现（还原 APP WatchingUpdateSorter.sortBySelection + MediaSortEngine）
// ============================================================================

/** 主排序值：复合值（「资源」= [资源名, 名称]）逐项比较，null 恒最后 */
type SortValue = number | string | readonly (number | string | null)[];

interface IndexedUpdate {
  item: WatchingUpdateItem;
  /** 基线顺序（更新时间降序）中的下标，用于稳定兜底 */
  baselineIndex: number;
  value: SortValue | null;
  tieBreakValue: number | null;
}

/**
 * 对追更提醒列表排序（调用方一般已过滤出 hasNewEpisode 的项，但不过滤也兼容）。
 *
 * @param items 追更检测项（任意顺序，内部先收敛到基线排序：更新时间降序）
 * @param selection 排序选择
 */
export function sortWatchingUpdates(
  items: readonly WatchingUpdateItem[],
  selection: WatchingUpdatesSortSelection,
): WatchingUpdateItem[] {
  // 基线排序：更新时间降序（与原 Web 端展示顺序一致），检测时间缺失恒最后
  const baseline = items
    .map((item, index) => ({ item, sourceIndex: index }))
    .sort((left, right) => {
      const leftTime = left.item.detectedAt;
      const rightTime = right.item.detectedAt;
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
      value: extractUpdateSortValue(entry.item, selection.type),
      tieBreakValue: extractUpdateTieBreakValue(entry.item, selection.type),
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

/** 主排序字段取值（与 APP WatchingUpdateSorter 的 valueOf 对应） */
function extractUpdateSortValue(
  item: WatchingUpdateItem,
  type: WatchingUpdatesSortType,
): SortValue | null {
  switch (type) {
    case 'title':
      return item.title;
    case 'newEpisodeCount':
      return item.newEpisodes > 0 ? item.newEpisodes : null;
    case 'updateDetectedAt':
      return item.detectedAt ?? null;
    case 'source':
      // APP 同款复合值：先资源名后名称
      return [item.sourceName ?? '', item.title];
  }
}

/**
 * 次级排序取值（与 APP WatchingUpdateSorter._tieBreakValueOf 对应，方向固定降序）：
 * - 更新集数：主值相等时先按更新时间新的在前，再回落基线顺序；
 * - 更新时间：主值相等时先按更新集数多的在前，再回落基线顺序；
 * - 其余排序返回 null（保持「相等时维持基线顺序」的原有行为）。
 */
function extractUpdateTieBreakValue(
  item: WatchingUpdateItem,
  type: WatchingUpdatesSortType,
): number | null {
  switch (type) {
    case 'newEpisodeCount':
      return item.detectedAt ?? null;
    case 'updateDetectedAt':
      return item.newEpisodes > 0 ? item.newEpisodes : null;
    default:
      return null;
  }
}

/** 次级排序比较：方向固定降序、null 恒最后，之后回落基线顺序（更新时间降序） */
function compareTieBreak(left: IndexedUpdate, right: IndexedUpdate): number {
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
