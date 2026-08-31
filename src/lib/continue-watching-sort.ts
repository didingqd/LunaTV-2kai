/**
 * 继续观看排序 —— 与 APP（Selene-Source）ContinueWatchingSortUseCase 同款逻辑
 *
 * 修改点：为 Web 端「继续观看」引入与 APP 一致的排序能力：
 * - 七种排序：最近观看（默认）/ 更新时间 / 更新集数 / 保存时间 / 观看进度 / 剩余时间 / 名称
 * - 「更新时间」「更新集数」为分组排序：有更新（新集数）的资源恒在最前，
 *   升降序只决定有更新组内部的排列方向（与 APP 的 Selene 修改点语义一致）
 * - 存储值字符串（default / update_first / update_last / new_episode_count_* /
 *   type:asc|desc）与 APP 保持一致，便于将来跨端同步偏好
 */

import { resolveContentIdentity } from './content-identity';
import type { PlayRecord } from './types';
import type { WatchingUpdateItem } from './watching-update-result';

// ============================================================================
// 类型定义
// ============================================================================

export type ContinueWatchingSortType =
  | 'lastWatchedAt' // 最近观看（默认）
  | 'continueWatchingUpdate' // 更新时间（有更新恒在最前）
  | 'continueWatchingNewEpisodeCount' // 更新集数（有更新恒在最前）
  | 'savedAt' // 保存时间
  | 'watchProgress' // 观看进度
  | 'remainingTime' // 剩余时间
  | 'title'; // 名称

export interface ContinueWatchingSortSelection {
  type: ContinueWatchingSortType;
  ascending: boolean;
}

export type ContinueWatchingRecord = PlayRecord & { key: string };

// ============================================================================
// 选项元数据（顺序与 APP history_screen 的 supportedSorts 一致）
// ============================================================================

export const CONTINUE_WATCHING_SORT_OPTIONS: readonly ContinueWatchingSortType[] =
  [
    'lastWatchedAt',
    'continueWatchingUpdate',
    'continueWatchingNewEpisodeCount',
    'savedAt',
    'watchProgress',
    'remainingTime',
    'title',
  ];

/** APP 同款默认排序：最近观看（save_time）降序 */
export const DEFAULT_CONTINUE_WATCHING_SORT_SELECTION: ContinueWatchingSortSelection =
  { type: 'lastWatchedAt', ascending: false };

const GROUPED_UPDATE_SORT_TYPES: ReadonlySet<ContinueWatchingSortType> =
  new Set(['continueWatchingUpdate', 'continueWatchingNewEpisodeCount']);

export function isGroupedUpdateSort(type: ContinueWatchingSortType): boolean {
  return GROUPED_UPDATE_SORT_TYPES.has(type);
}

/** 各排序字段的中文名称（与 APP MediaSortTypePresentation.label 一致） */
export function continueWatchingSortLabel(
  type: ContinueWatchingSortType,
): string {
  switch (type) {
    case 'lastWatchedAt':
      return '最近观看';
    case 'continueWatchingUpdate':
      return '更新时间';
    case 'continueWatchingNewEpisodeCount':
      return '更新集数';
    case 'savedAt':
      return '保存时间';
    case 'watchProgress':
      return '观看进度';
    case 'remainingTime':
      return '剩余时间';
    case 'title':
      return '名称';
  }
}

/** 选择新字段时使用的默认方向（与 APP MediaSortType.defaultAscending 一致） */
export function continueWatchingSortDefaultAscending(
  type: ContinueWatchingSortType,
): boolean {
  return type === 'title';
}

/**
 * 方向文案（与 APP MediaSortTypePresentation.directionLabel 一致）。
 * 「更新时间/更新集数」的升降序只作用于有更新组内部，
 * 因此文案为「新加入在前/在后」「从多到少/从少到多」。
 */
export function continueWatchingSortDirectionLabel(
  type: ContinueWatchingSortType,
  ascending: boolean,
): string {
  switch (type) {
    case 'title':
      return ascending ? '从A到Z' : '从Z到A';
    case 'savedAt':
      return ascending ? '最早保存' : '最近保存';
    case 'lastWatchedAt':
      return ascending ? '最早观看' : '最近观看';
    case 'continueWatchingUpdate':
      return ascending ? '新加入在后' : '新加入在前';
    case 'continueWatchingNewEpisodeCount':
      return ascending ? '从少到多' : '从多到少';
    case 'watchProgress':
      return ascending ? '进度低在前' : '进度高在前';
    case 'remainingTime':
      return ascending ? '从少到多' : '从多到少';
  }
}

// ============================================================================
// 偏好持久化值（字符串格式与 APP ContinueWatchingSortSelection.storageValue 一致）
// ============================================================================

export function continueWatchingSortStorageValue(
  selection: ContinueWatchingSortSelection,
): string {
  if (selection.type === 'lastWatchedAt' && !selection.ascending) {
    return 'default';
  }
  if (selection.type === 'continueWatchingUpdate') {
    // update_first = 有更新组内「新加入在前」（降序），与 APP 保持一致
    return selection.ascending ? 'update_last' : 'update_first';
  }
  if (selection.type === 'continueWatchingNewEpisodeCount') {
    return selection.ascending
      ? 'new_episode_count_last'
      : 'new_episode_count_first';
  }
  return `${selection.type}:${selection.ascending ? 'asc' : 'desc'}`;
}

export function continueWatchingSortSelectionFromStorageValue(
  value: string | null | undefined,
): ContinueWatchingSortSelection {
  switch (value) {
    case 'update_first':
      return { type: 'continueWatchingUpdate', ascending: false };
    case 'update_last':
      return { type: 'continueWatchingUpdate', ascending: true };
    case 'new_episode_count_first':
      return { type: 'continueWatchingNewEpisodeCount', ascending: false };
    case 'new_episode_count_last':
      return { type: 'continueWatchingNewEpisodeCount', ascending: true };
    case 'default':
    case null:
    case undefined:
      return DEFAULT_CONTINUE_WATCHING_SORT_SELECTION;
  }

  // 通用格式 type:asc|desc（分组排序走上面的专用字符串，不在这里解析）
  const parts = value.split(':');
  if (parts.length !== 2) return DEFAULT_CONTINUE_WATCHING_SORT_SELECTION;
  const [typeName, direction] = parts;
  if (
    typeName !== 'lastWatchedAt' &&
    typeName !== 'savedAt' &&
    typeName !== 'watchProgress' &&
    typeName !== 'remainingTime' &&
    typeName !== 'title'
  ) {
    return DEFAULT_CONTINUE_WATCHING_SORT_SELECTION;
  }
  return {
    type: typeName,
    ascending: direction === 'asc',
  };
}

// ============================================================================
// 排序实现（还原 APP ContinueWatchingSortUseCase.sort）
// ============================================================================

// 修改点：导出 UpdateSortInfo 与 buildUpdateInfoMap，供收藏排序
//（favorites-sort.ts）复用同一份「有新集数」判断与 identityKey 匹配逻辑。
export interface UpdateSortInfo {
  detectedAt?: number;
  newEpisodes: number;
}

interface IndexedRecord {
  record: ContinueWatchingRecord;
  /** 基线顺序（save_time 降序）中的下标，用于稳定兜底 */
  baselineIndex: number;
}
/**
 * 对继续观看记录排序。
 *
 * @param records 播放记录（任意顺序，内部先收敛到基线排序）
 * @param selection 排序选择
 * @param updatedSeries 追更检测结果（用于「更新时间/更新集数」分组排序）
 */
export function sortContinueWatchingRecords(
  records: readonly ContinueWatchingRecord[],
  selection: ContinueWatchingSortSelection,
  updatedSeries?: readonly WatchingUpdateItem[] | null,
): ContinueWatchingRecord[] {
  // 基线排序：save_time 降序（与原 Web 端默认行为一致），空值排最后
  const baseline = sortBaseline(records);
  if (isGroupedUpdateSort(selection.type)) {
    return sortGroupedByUpdate(
      baseline,
      selection,
      buildUpdateInfoMap(updatedSeries),
    );
  }
  return sortByMediaSelection(baseline, selection);
}

/** 基线排序：最近观看（save_time）降序，是所有其它排序的稳定兜底顺序 */
function sortBaseline(
  records: readonly ContinueWatchingRecord[],
): IndexedRecord[] {
  // 兜底顺序必须与 APP 一致：主排序相等时回落到「基线排序后的位置」，
  // 因此先按 save_time 排序，再用排序结果的位置作为 baselineIndex。
  return records
    .map((record, index) => ({ record, sourceIndex: index }))
    .sort((left, right) => {
      const leftTime = left.record.save_time;
      const rightTime = right.record.save_time;
      if (leftTime == null && rightTime == null) {
        return left.sourceIndex - right.sourceIndex;
      }
      if (leftTime == null) return 1;
      if (rightTime == null) return -1;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.sourceIndex - right.sourceIndex;
    })
    .map((entry, index) => ({
      record: entry.record,
      baselineIndex: index,
    }));
}

/** 非分组排序：按字段取值排序，空值恒在最后，相等回落基线顺序（与 APP MediaSortEngine 一致） */
function sortByMediaSelection(
  baseline: IndexedRecord[],
  selection: ContinueWatchingSortSelection,
): ContinueWatchingRecord[] {
  return baseline
    .map((entry) => ({
      entry,
      value: extractSortValue(entry.record, selection.type),
    }))
    .sort((left, right) => {
      if (left.value == null && right.value == null) {
        return left.entry.baselineIndex - right.entry.baselineIndex;
      }
      if (left.value == null) return 1;
      if (right.value == null) return -1;
      const comparison = compareSortValues(left.value, right.value);
      if (comparison !== 0) {
        return selection.ascending ? comparison : -comparison;
      }
      return left.entry.baselineIndex - right.entry.baselineIndex;
    })
    .map(({ entry }) => entry.record);
}

/** 排序字段取值（与 APP _sortValueOf 对应；分组排序字段返回 null） */
function extractSortValue(
  record: ContinueWatchingRecord,
  type: ContinueWatchingSortType,
): string | number | null {
  switch (type) {
    case 'lastWatchedAt':
    case 'savedAt':
      return record.save_time;
    case 'watchProgress':
      return record.total_time > 0
        ? record.play_time / record.total_time
        : null;
    case 'remainingTime':
      return record.total_time > 0
        ? Math.max(0, record.total_time - record.play_time)
        : null;
    case 'title':
      return record.title;
    case 'continueWatchingUpdate':
    case 'continueWatchingNewEpisodeCount':
      return null;
  }
}

/** 数值直接比较；字符串使用拼音感知 + 数字感知的中文排序（近似 APP 的拼音首字母自然排序） */
const zhCollator =
  typeof Intl !== 'undefined'
    ? new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    : null;

// 修改点：导出字符串/数值比较器，收藏排序（favorites-sort.ts）复用同一中文排序口径
export function compareSortValues(
  left: number | string,
  right: number | string,
) {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  const leftString = String(left);
  const rightString = String(right);
  if (zhCollator) return zhCollator.compare(leftString, rightString);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
}

/** 追更检测结果按 identityKey 建索引，只保留「有新集数」的项 */
export function buildUpdateInfoMap(
  updatedSeries?: readonly WatchingUpdateItem[] | null,
): Map<string, UpdateSortInfo> {
  const map = new Map<string, UpdateSortInfo>();
  if (!updatedSeries) return map;
  for (const series of updatedSeries) {
    if (!series.hasNewEpisode || series.newEpisodes <= 0) continue;
    const identity = resolveContentIdentity(series);
    if (!identity) continue;
    map.set(identity.identityKey, {
      detectedAt: series.detectedAt,
      newEpisodes: series.newEpisodes,
    });
  }
  return map;
}

/**
 * 分组排序（APP 同款语义）：
 * 有更新的记录恒在最前，升降序只决定组内方向；
 * 无更新组保持基线顺序，不参与更新排序。
 */
function sortGroupedByUpdate(
  baseline: IndexedRecord[],
  selection: ContinueWatchingSortSelection,
  updateInfoMap: Map<string, UpdateSortInfo>,
): ContinueWatchingRecord[] {
  const updated: Array<IndexedRecord & UpdateSortInfo> = [];
  const normal: IndexedRecord[] = [];

  for (const entry of baseline) {
    const identity = resolveContentIdentity(entry.record.key);
    const info = identity ? updateInfoMap.get(identity.identityKey) : undefined;
    if (info) {
      updated.push({ ...entry, ...info });
    } else {
      normal.push(entry);
    }
  }

  updated.sort((left, right) =>
    selection.type === 'continueWatchingNewEpisodeCount'
      ? compareByNewEpisodeCount(left, right, selection.ascending)
      : compareByDetectedAt(left, right, selection.ascending),
  );

  return [
    ...updated.map((entry) => entry.record),
    ...normal.map((entry) => entry.record),
  ];
}

/** 「更新集数」组内比较：降序=多的在前；相同时更新时间新的在前（方向固定），再回落基线顺序 */
function compareByNewEpisodeCount(
  left: IndexedRecord & UpdateSortInfo,
  right: IndexedRecord & UpdateSortInfo,
  ascending: boolean,
): number {
  const comparison = right.newEpisodes - left.newEpisodes;
  if (comparison !== 0) return ascending ? -comparison : comparison;
  return compareDetectedAtDescending(left, right);
}

/** 「更新时间」组内比较：降序=新加入在前；时间未知恒在有时间的之后（两方向一致），再回落基线顺序 */
function compareByDetectedAt(
  left: IndexedRecord & UpdateSortInfo,
  right: IndexedRecord & UpdateSortInfo,
  ascending: boolean,
): number {
  if (left.detectedAt != null && right.detectedAt != null) {
    const comparison = right.detectedAt - left.detectedAt;
    if (comparison !== 0) return ascending ? -comparison : comparison;
  } else if (left.detectedAt != null) {
    return -1;
  } else if (right.detectedAt != null) {
    return 1;
  }
  // 更新时间相同（批量检测常见）时先按更新集数多的在前（方向固定），再回落基线顺序
  const episodeComparison = right.newEpisodes - left.newEpisodes;
  if (episodeComparison !== 0) return episodeComparison;
  return left.baselineIndex - right.baselineIndex;
}

/** 「更新集数」相同时的兜底：更新时间新的在前（方向固定），再回落基线顺序 */
function compareDetectedAtDescending(
  left: IndexedRecord & UpdateSortInfo,
  right: IndexedRecord & UpdateSortInfo,
): number {
  if (left.detectedAt != null && right.detectedAt != null) {
    const comparison = right.detectedAt - left.detectedAt;
    if (comparison !== 0) return comparison;
  } else if (left.detectedAt != null) {
    return -1;
  } else if (right.detectedAt != null) {
    return 1;
  }
  const episodeComparison = right.newEpisodes - left.newEpisodes;
  if (episodeComparison !== 0) return episodeComparison;
  return left.baselineIndex - right.baselineIndex;
}
