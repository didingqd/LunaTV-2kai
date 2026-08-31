/**
 * 追更列表排序 —— 与 APP（Selene-Source）ReminderListScreen 同款排序逻辑
 *
 * 修改点：为 Web 端用户菜单「更新提醒 → 我的追更」列表补齐与 APP 一致的排序能力：
 * - 五种排序：保存时间（默认）/ 更新集数 / 更新时间 / 名称 / 年份
 *   （顺序与 APP ReminderListScreen supportedSorts 一致）
 * - 与 APP MediaSortEngine 相同的语义：
 *   - null 恒排最后（两个方向都一致），「更新集数」排序下无更新（0 集）映射为 null，
 *     因此有更新的追更恒在无更新之前；
 *   - 「更新集数 / 更新时间」排序主值相等时，次级排序固定降序
 *     （更新集数：先更新时间新的在前，再保存时间从新到旧；更新时间同理互换），
 *     其余排序主值相等时维持基线顺序（保存时间从新到旧）。
 * - 存储值字符串（type:asc|desc）与 APP MediaSortPreferenceService 通用格式一致，
 *   localStorage 键独立（watching-list 前缀对应 APP keyPrefix），不与收藏/继续观看混用
 */

import { buildContentIdentityKey } from './content-identity';
import {
  compareSortValues,
  type UpdateSortInfo,
} from './continue-watching-sort';
import type { WatchingFollow } from './types';
import type { WatchingUpdateItem } from './watching-update-result';

// ============================================================================
// 类型定义
// ============================================================================

export type WatchingFollowsSortType =
  | 'savedAt' // 保存时间（默认，即加入追更时间）
  | 'newEpisodeCount' // 更新集数（无更新恒在后）
  | 'updateDetectedAt' // 更新时间（无更新恒在后）
  | 'title' // 名称
  | 'year'; // 年份

export interface WatchingFollowsSortSelection {
  type: WatchingFollowsSortType;
  ascending: boolean;
}

// ============================================================================
// 选项元数据（顺序与 APP ReminderListScreen 的 supportedSorts 一致）
// ============================================================================

export const WATCHING_FOLLOWS_SORT_OPTIONS: readonly WatchingFollowsSortType[] =
  ['savedAt', 'newEpisodeCount', 'updateDetectedAt', 'title', 'year'];

/** APP 同款默认排序：保存时间降序（即加入追更时间从新到旧，Web 原有顺序） */
export const DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION: WatchingFollowsSortSelection =
  { type: 'savedAt', ascending: false };

/** 各排序字段的中文名称（与 APP MediaSortTypePresentation.label 一致） */
export function watchingFollowsSortLabel(
  type: WatchingFollowsSortType,
): string {
  switch (type) {
    case 'savedAt':
      return '保存时间';
    case 'newEpisodeCount':
      return '更新集数';
    case 'updateDetectedAt':
      return '更新时间';
    case 'title':
      return '名称';
    case 'year':
      return '年份';
  }
}

/** 选择新字段时使用的默认方向（与 APP MediaSortType.defaultAscending 一致） */
export function watchingFollowsSortDefaultAscending(
  type: WatchingFollowsSortType,
): boolean {
  return type === 'title';
}

/** 方向文案（与 APP MediaSortTypePresentation.directionLabel 一致） */
export function watchingFollowsSortDirectionLabel(
  type: WatchingFollowsSortType,
  ascending: boolean,
): string {
  switch (type) {
    case 'title':
      return ascending ? '从A到Z' : '从Z到A';
    case 'savedAt':
      return ascending ? '最早保存' : '最近保存';
    case 'newEpisodeCount':
      return ascending ? '从少到多' : '从多到少';
    case 'updateDetectedAt':
      return ascending ? '新加入在后' : '新加入在前';
    case 'year':
      return ascending ? '从旧到新' : '从新到旧';
  }
}

// ============================================================================
// 偏好持久化值（字符串格式与 APP MediaSortPreferenceService 通用格式一致）
// ============================================================================

export function watchingFollowsSortStorageValue(
  selection: WatchingFollowsSortSelection,
): string {
  return `${selection.type}:${selection.ascending ? 'asc' : 'desc'}`;
}

export function watchingFollowsSortSelectionFromStorageValue(
  value: string | null | undefined,
): WatchingFollowsSortSelection {
  if (value == null) return DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION;
  const parts = value.split(':');
  if (parts.length !== 2) return DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION;
  const [typeName, direction] = parts;
  if (
    typeName !== 'savedAt' &&
    typeName !== 'newEpisodeCount' &&
    typeName !== 'updateDetectedAt' &&
    typeName !== 'title' &&
    typeName !== 'year'
  ) {
    return DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION;
  }
  if (direction !== 'asc' && direction !== 'desc') {
    return DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION;
  }
  return { type: typeName, ascending: direction === 'asc' };
}

// ============================================================================
// 排序实现（还原 APP MediaSortEngine.sort + ReminderListScreen 的取值与兜底声明）
// ============================================================================

/** 主排序值（本列表无「资源」复合值，仅标量） */
type SortValue = number | string;

interface IndexedFollow {
  item: WatchingFollow;
  /** 基线顺序（保存时间降序）中的下标，用于稳定兜底 */
  baselineIndex: number;
  value: SortValue | null;
  tieBreakValue: number | null;
}

/**
 * 对追更列表排序。
 *
 * @param items 追更关注项（任意顺序，内部先收敛到基线排序：保存时间降序）
 * @param selection 排序选择
 * @param updatedSeries 追更检测结果（用于「更新集数 / 更新时间」排序）
 */
export function sortWatchingFollows(
  items: readonly WatchingFollow[],
  selection: WatchingFollowsSortSelection,
  updatedSeries?: readonly WatchingUpdateItem[] | null,
): WatchingFollow[] {
  const updateInfoMap = buildFollowUpdateInfoMap(items, updatedSeries);
  // 基线排序：保存时间（createdAt）降序，与原 Web 端展示顺序一致，null 恒最后
  const baseline = items
    .map((item, index) => ({ item, sourceIndex: index }))
    .sort((left, right) => {
      const leftTime = left.item.createdAt;
      const rightTime = right.item.createdAt;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.sourceIndex - right.sourceIndex;
    })
    .map((entry, index) => ({
      item: entry.item,
      baselineIndex: index,
      value: extractFollowSortValue(entry.item, selection.type, updateInfoMap),
      tieBreakValue: extractFollowTieBreakValue(
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
      const comparison = compareSortValues(left.value, right.value);
      if (comparison !== 0) {
        return selection.ascending ? comparison : -comparison;
      }
      // 主排序值相等（含批量检测共享同一检测时间等场景）时走次级排序
      return compareTieBreak(left, right);
    })
    .map(({ item }) => item);
}

/**
 * 追更检测项按「追更关注的 canonical 身份 key」建索引。
 * 修改点：与 buildUpdateInfoMap 的差异在于 key 的来源 —— 追更列表项只有
 * source/id（WatchingFollow），检测项是 sourceKey/videoId（WatchingUpdateItem），
 * 两侧分别用 buildContentIdentityKey 归一到同一 canonical key 再匹配。
 */
function buildFollowUpdateInfoMap(
  items: readonly WatchingFollow[],
  updatedSeries?: readonly WatchingUpdateItem[] | null,
): Map<string, UpdateSortInfo> {
  const map = new Map<string, UpdateSortInfo>();
  if (!updatedSeries) return map;
  const wantedKeys = new Set(
    items
      .map((item) => buildFollowIdentityKey(item))
      .filter((key): key is string => key !== null),
  );
  for (const series of updatedSeries) {
    if (!series.hasNewEpisode || series.newEpisodes <= 0) continue;
    const key = buildSeriesIdentityKey(series);
    if (key === null || !wantedKeys.has(key)) continue;
    map.set(key, {
      detectedAt: series.detectedAt,
      newEpisodes: series.newEpisodes,
    });
  }
  return map;
}

function buildFollowIdentityKey(item: WatchingFollow): string | null {
  if (!item.source || !item.id) return null;
  return buildContentIdentityKey(item.source, item.id);
}

function buildSeriesIdentityKey(series: WatchingUpdateItem): string | null {
  const source = series.sourceKey ?? series.source;
  const id = series.videoId ?? series.id;
  if (!source || !id) return null;
  return buildContentIdentityKey(source, id);
}

/**
 * 主排序字段取值（与 APP _sortValueOfReminderListItem 对应）。
 * 「更新集数」把无更新（0 集）映射为 null，配合 null-last 语义，
 * 保证有更新的追更恒在无更新之前（升降序都成立）。
 */
function extractFollowSortValue(
  item: WatchingFollow,
  type: WatchingFollowsSortType,
  updateInfoMap: Map<string, UpdateSortInfo>,
): SortValue | null {
  const key = buildFollowIdentityKey(item);
  const updateInfo = key ? updateInfoMap.get(key) : undefined;
  switch (type) {
    case 'savedAt':
      return item.createdAt;
    case 'newEpisodeCount':
      return updateInfo && updateInfo.newEpisodes > 0
        ? updateInfo.newEpisodes
        : null;
    case 'updateDetectedAt':
      return updateInfo?.detectedAt ?? null;
    case 'title':
      return item.title;
    case 'year': {
      const parsed = Number.parseInt(String(item.year ?? '').trim(), 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
  }
}

/**
 * 次级排序取值（与 APP _sortTieBreakValueOfReminderListItem 对应，方向固定降序）：
 * - 更新集数：主值相等时先按更新时间新的在前，再按保存时间从新到旧；
 * - 更新时间：主值相等时先按更新集数多的在前，再按保存时间从新到旧；
 * - 其余排序返回 null（保持「相等时维持基线顺序」的原有行为）。
 * 保存时间兜底由 baselineIndex（基线=保存时间降序）承担。
 */
function extractFollowTieBreakValue(
  item: WatchingFollow,
  type: WatchingFollowsSortType,
  updateInfoMap: Map<string, UpdateSortInfo>,
): number | null {
  const key = buildFollowIdentityKey(item);
  const updateInfo = key ? updateInfoMap.get(key) : undefined;
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
function compareTieBreak(left: IndexedFollow, right: IndexedFollow): number {
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
