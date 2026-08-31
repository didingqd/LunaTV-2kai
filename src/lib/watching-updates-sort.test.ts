/**
 * 追更提醒排序（watching-updates-sort）单元测试
 *
 * 修改点：验证与 APP（Selene-Source）UpdateReminderScreen / WatchingUpdateSorter
 * 对齐的排序语义：存储值往返、默认排序、各字段排序、null-last、tie-break。
 */

import type { WatchingUpdateItem } from './watching-update-result';
import {
  DEFAULT_WATCHING_UPDATES_SORT_SELECTION,
  sortWatchingUpdates,
  WATCHING_UPDATES_SORT_OPTIONS,
  watchingUpdatesSortDefaultAscending,
  watchingUpdatesSortDirectionLabel,
  watchingUpdatesSortLabel,
  watchingUpdatesSortSelectionFromStorageValue,
  watchingUpdatesSortStorageValue,
} from './watching-updates-sort';

// 追更检测项工厂：仅填排序所需的字段
function series(
  key: string,
  overrides: Partial<WatchingUpdateItem> = {},
): WatchingUpdateItem {
  return {
    title: key,
    sourceName: '源A',
    source_name: '源A',
    year: '2024',
    cover: '',
    identityKey: key,
    source: 'src',
    id: key,
    sourceKey: 'src',
    videoId: key,
    currentEpisode: 1,
    totalEpisodes: 12,
    hasNewEpisode: true,
    hasContinueWatching: false,
    hasNewRelease: false,
    newEpisodes: 1,
    remainingEpisodes: 10,
    releasedEpisodes: 1,
    unwatchedEpisodes: 10,
    latestEpisodes: 12,
    completed: false,
    detectedAt: 1000,
    ...overrides,
  };
}

const namesOf = (items: readonly WatchingUpdateItem[]) =>
  items.map((item) => item.title);

describe('watching-updates-sort 存储值', () => {
  it('存储值往返保持一致（type:asc|desc，与 APP 通用格式一致）', () => {
    for (const type of WATCHING_UPDATES_SORT_OPTIONS) {
      for (const ascending of [true, false]) {
        const selection = { type, ascending };
        expect(
          watchingUpdatesSortSelectionFromStorageValue(
            watchingUpdatesSortStorageValue(selection),
          ),
        ).toEqual(selection);
      }
    }
  });

  it('非法存储值回落默认排序（更新时间降序）', () => {
    for (const invalid of [
      null,
      undefined,
      '',
      'nonsense',
      'title',
      'title:up',
      'unknown:desc',
      'title:asc:extra',
    ]) {
      expect(watchingUpdatesSortSelectionFromStorageValue(invalid)).toEqual(
        DEFAULT_WATCHING_UPDATES_SORT_SELECTION,
      );
    }
  });

  it('元数据文案与 APP 一致', () => {
    expect(watchingUpdatesSortLabel('title')).toBe('名称');
    expect(watchingUpdatesSortLabel('newEpisodeCount')).toBe('更新集数');
    expect(watchingUpdatesSortLabel('updateDetectedAt')).toBe('更新时间');
    expect(watchingUpdatesSortLabel('source')).toBe('资源');
    // 「名称 / 资源」默认升序（与 APP defaultAscending 一致）
    expect(watchingUpdatesSortDefaultAscending('title')).toBe(true);
    expect(watchingUpdatesSortDefaultAscending('source')).toBe(true);
    expect(watchingUpdatesSortDefaultAscending('updateDetectedAt')).toBe(false);
    expect(watchingUpdatesSortDirectionLabel('source', true)).toBe('从A到Z');
    expect(watchingUpdatesSortDirectionLabel('source', false)).toBe('从Z到A');
    expect(watchingUpdatesSortDirectionLabel('updateDetectedAt', false)).toBe(
      '新加入在前',
    );
    expect(watchingUpdatesSortDirectionLabel('newEpisodeCount', true)).toBe(
      '从少到多',
    );
  });
});

describe('sortWatchingUpdates 排序', () => {
  it('默认排序：更新时间降序（新加入在前），检测时间缺失恒在最后', () => {
    const items = [
      series('A', { detectedAt: 100 }),
      series('B', { detectedAt: 300 }),
      series('C', { detectedAt: 200 }),
      series('D', { detectedAt: undefined }),
    ];
    expect(
      namesOf(
        sortWatchingUpdates(items, DEFAULT_WATCHING_UPDATES_SORT_SELECTION),
      ),
    ).toEqual(['B', 'C', 'A', 'D']);
  });

  it('更新时间升序：新加入在后，缺失检测时间仍在最后（null-last）', () => {
    const items = [
      series('A', { detectedAt: 100 }),
      series('B', { detectedAt: 300 }),
      series('D', { detectedAt: undefined }),
    ];
    expect(
      namesOf(
        sortWatchingUpdates(items, {
          type: 'updateDetectedAt',
          ascending: true,
        }),
      ),
    ).toEqual(['A', 'B', 'D']);
  });

  it('更新集数降序：从多到少；升序：从少到多（0 集映射为 null 恒在后）', () => {
    const items = [
      series('A', { newEpisodes: 2 }),
      series('B', { newEpisodes: 5 }),
      series('C', { newEpisodes: 0 }),
    ];
    expect(
      namesOf(
        sortWatchingUpdates(items, {
          type: 'newEpisodeCount',
          ascending: false,
        }),
      ),
    ).toEqual(['B', 'A', 'C']);
    expect(
      namesOf(
        sortWatchingUpdates(items, {
          type: 'newEpisodeCount',
          ascending: true,
        }),
      ),
    ).toEqual(['A', 'B', 'C']);
  });

  it('更新集数 tie-break：集数相同时更新时间新的在前（方向固定降序）', () => {
    const items = [
      series('A', { newEpisodes: 2, detectedAt: 100 }),
      series('B', { newEpisodes: 2, detectedAt: 300 }),
    ];
    expect(
      namesOf(
        sortWatchingUpdates(items, {
          type: 'newEpisodeCount',
          ascending: false,
        }),
      ),
    ).toEqual(['B', 'A']);
    // 方向翻转不影响 tie-break 方向
    expect(
      namesOf(
        sortWatchingUpdates(items, {
          type: 'newEpisodeCount',
          ascending: true,
        }),
      ),
    ).toEqual(['B', 'A']);
  });

  it('更新时间 tie-break：同批检测时更新集数多的在前（方向固定降序）', () => {
    const items = [
      series('A', { newEpisodes: 1, detectedAt: 300 }),
      series('B', { newEpisodes: 4, detectedAt: 300 }),
    ];
    expect(
      namesOf(
        sortWatchingUpdates(items, {
          type: 'updateDetectedAt',
          ascending: false,
        }),
      ),
    ).toEqual(['B', 'A']);
    expect(
      namesOf(
        sortWatchingUpdates(items, {
          type: 'updateDetectedAt',
          ascending: true,
        }),
      ),
    ).toEqual(['B', 'A']);
  });

  it('名称排序：默认升序（A-Z），切换为降序（Z-A）', () => {
    const items = [series('B'), series('A'), series('C')];
    expect(
      namesOf(sortWatchingUpdates(items, { type: 'title', ascending: true })),
    ).toEqual(['A', 'B', 'C']);
    expect(
      namesOf(sortWatchingUpdates(items, { type: 'title', ascending: false })),
    ).toEqual(['C', 'B', 'A']);
  });

  it('资源排序：复合值先资源名后名称；默认升序，切换为降序', () => {
    const items = [
      series('A', { sourceName: 'Zy', source_name: 'Zy' }),
      series('B', { sourceName: 'Mars', source_name: 'Mars' }),
      series('C', { sourceName: 'Mars', source_name: 'Mars' }),
      series('D', { sourceName: 'Alpha', source_name: 'Alpha' }),
    ];
    expect(
      namesOf(sortWatchingUpdates(items, { type: 'source', ascending: true })),
    ).toEqual(['D', 'B', 'C', 'A']);
    expect(
      namesOf(sortWatchingUpdates(items, { type: 'source', ascending: false })),
    ).toEqual(['A', 'C', 'B', 'D']);
  });

  it('相等时回落基线顺序（更新时间降序），保证排序稳定', () => {
    const items = [
      series('First', { detectedAt: 100 }),
      series('Second', { detectedAt: 100 }),
      series('Third', { detectedAt: 100 }),
    ];
    expect(
      namesOf(sortWatchingUpdates(items, { type: 'title', ascending: false })),
    ).toEqual(['Third', 'Second', 'First']);
  });
});
