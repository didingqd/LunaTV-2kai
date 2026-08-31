import { buildContentIdentityKey } from './content-identity';
import {
  type ContinueWatchingRecord,
  continueWatchingSortDefaultAscending,
  continueWatchingSortDirectionLabel,
  continueWatchingSortLabel,
  type ContinueWatchingSortSelection,
  continueWatchingSortSelectionFromStorageValue,
  continueWatchingSortStorageValue,
  type ContinueWatchingSortType,
  DEFAULT_CONTINUE_WATCHING_SORT_SELECTION,
  sortContinueWatchingRecords,
} from './continue-watching-sort';
import type { PlayRecord } from './types';
import type { WatchingUpdateItem } from './watching-update-result';

// ============================================================================
// 测试数据构造
// ============================================================================

function record(
  overrides: Partial<PlayRecord> & { key: string; title: string },
): ContinueWatchingRecord {
  return {
    source_name: '测试源',
    cover: '',
    year: '2024',
    index: 1,
    total_episodes: 12,
    play_time: 600,
    total_time: 1200,
    save_time: 1000,
    search_title: overrides.title,
    ...overrides,
  };
}

/** key 格式：source+id（与解析逻辑兼容即可，identity 只取 source/id） */
function identityOf(key: string) {
  const separator = key.indexOf('+');
  return {
    source: key.slice(0, separator),
    id: key.slice(separator + 1),
    identityKey: buildContentIdentityKey(
      key.slice(0, separator),
      key.slice(separator + 1),
    ),
  };
}

function updateItem(overrides: {
  key: string;
  newEpisodes: number;
  detectedAt?: number;
  hasNewEpisode?: boolean;
}): WatchingUpdateItem {
  const identity = identityOf(overrides.key);
  return {
    title: '',
    sourceName: '测试源',
    source_name: '测试源',
    year: '',
    cover: '',
    identityKey: identity.identityKey,
    source: identity.source,
    id: identity.id,
    sourceKey: identity.source,
    videoId: identity.id,
    currentEpisode: 1,
    totalEpisodes: 12,
    hasNewEpisode: overrides.hasNewEpisode ?? true,
    hasContinueWatching: false,
    hasNewRelease: false,
    newEpisodes: overrides.newEpisodes,
    remainingEpisodes: 0,
    releasedEpisodes: overrides.newEpisodes,
    unwatchedEpisodes: 0,
    latestEpisodes: 12,
    completed: false,
    detectedAt: overrides.detectedAt,
  };
}

const titles = (records: ContinueWatchingRecord[]) =>
  records.map((item) => item.title);

/** 快捷排序：返回标题顺序 */
function sortedTitles(
  records: ContinueWatchingRecord[],
  type: ContinueWatchingSortType,
  ascending: boolean,
  updates?: WatchingUpdateItem[],
) {
  return titles(
    sortContinueWatchingRecords(records, { type, ascending }, updates ?? null),
  );
}

// ============================================================================
// 持久化值（与 APP 字符串格式一致）
// ============================================================================

describe('continue-watching-sort storage value', () => {
  it('默认排序（最近观看降序）存储为 default', () => {
    expect(
      continueWatchingSortStorageValue({
        type: 'lastWatchedAt',
        ascending: false,
      }),
    ).toBe('default');
    expect(continueWatchingSortSelectionFromStorageValue('default')).toEqual(
      DEFAULT_CONTINUE_WATCHING_SORT_SELECTION,
    );
  });

  it('更新时间/更新集数使用 APP 专用字符串', () => {
    expect(
      continueWatchingSortStorageValue({
        type: 'continueWatchingUpdate',
        ascending: false,
      }),
    ).toBe('update_first');
    expect(
      continueWatchingSortSelectionFromStorageValue('update_last'),
    ).toEqual({ type: 'continueWatchingUpdate', ascending: true });
    expect(
      continueWatchingSortStorageValue({
        type: 'continueWatchingNewEpisodeCount',
        ascending: false,
      }),
    ).toBe('new_episode_count_first');
    expect(
      continueWatchingSortSelectionFromStorageValue('new_episode_count_last'),
    ).toEqual({ type: 'continueWatchingNewEpisodeCount', ascending: true });
  });

  it('通用排序使用 type:asc|desc 格式并往返一致', () => {
    const cases: ContinueWatchingSortSelection[] = [
      { type: 'title', ascending: true },
      { type: 'title', ascending: false },
      { type: 'savedAt', ascending: true },
      { type: 'watchProgress', ascending: false },
      { type: 'remainingTime', ascending: true },
      { type: 'lastWatchedAt', ascending: true },
    ];
    for (const selection of cases) {
      expect(
        continueWatchingSortSelectionFromStorageValue(
          continueWatchingSortStorageValue(selection),
        ),
      ).toEqual(selection);
    }
  });

  it('非法/未知值回落默认排序', () => {
    expect(continueWatchingSortSelectionFromStorageValue('random')).toEqual(
      DEFAULT_CONTINUE_WATCHING_SORT_SELECTION,
    );
    expect(
      continueWatchingSortSelectionFromStorageValue(
        'continueWatchingUpdate:asc',
      ),
    ).toEqual(DEFAULT_CONTINUE_WATCHING_SORT_SELECTION);
    expect(continueWatchingSortSelectionFromStorageValue(null)).toEqual(
      DEFAULT_CONTINUE_WATCHING_SORT_SELECTION,
    );
  });
});

// ============================================================================
// 元数据（与 APP 文案一致）
// ============================================================================

describe('continue-watching-sort metadata', () => {
  it('名称排序默认升序，其它默认降序', () => {
    expect(continueWatchingSortDefaultAscending('title')).toBe(true);
    expect(continueWatchingSortDefaultAscending('lastWatchedAt')).toBe(false);
    expect(continueWatchingSortDefaultAscending('continueWatchingUpdate')).toBe(
      false,
    );
  });

  it('方向文案与 APP 一致', () => {
    expect(continueWatchingSortLabel('continueWatchingUpdate')).toBe(
      '更新时间',
    );
    expect(
      continueWatchingSortDirectionLabel('continueWatchingUpdate', false),
    ).toBe('新加入在前');
    expect(
      continueWatchingSortDirectionLabel('continueWatchingUpdate', true),
    ).toBe('新加入在后');
    expect(continueWatchingSortDirectionLabel('title', true)).toBe('从A到Z');
    expect(continueWatchingSortDirectionLabel('lastWatchedAt', false)).toBe(
      '最近观看',
    );
  });
});

// ============================================================================
// 排序行为
// ============================================================================

describe('sortContinueWatchingRecords', () => {
  it('默认排序：最近观看（save_time）降序，与原行为一致', () => {
    const records = [
      record({ key: 'a+1', title: 'A', save_time: 100 }),
      record({ key: 'b+1', title: 'B', save_time: 300 }),
      record({ key: 'c+1', title: 'C', save_time: 200 }),
    ];
    expect(
      titles(
        sortContinueWatchingRecords(
          records,
          DEFAULT_CONTINUE_WATCHING_SORT_SELECTION,
        ),
      ),
    ).toEqual(['B', 'C', 'A']);
  });

  it('save_time 为 0 的记录按数值参与排序', () => {
    const records = [
      record({ key: 'a+1', title: 'A', save_time: 100 }),
      record({ key: 'b+1', title: 'B', save_time: 0 }),
      record({ key: 'c+1', title: 'C', save_time: 200 }),
    ];
    // 降序：0 最晚；升序：0 最早
    expect(sortedTitles(records, 'lastWatchedAt', false)).toEqual([
      'C',
      'A',
      'B',
    ]);
    expect(sortedTitles(records, 'lastWatchedAt', true)).toEqual([
      'B',
      'A',
      'C',
    ]);
  });

  it('save_time 缺失的记录排在最后（无论方向，与 APP 空值语义一致）', () => {
    const records = [
      record({ key: 'a+1', title: 'A', save_time: 100 }),
      record({
        key: 'b+1',
        title: 'B',
        save_time: undefined as unknown as number,
      }),
      record({ key: 'c+1', title: 'C', save_time: 200 }),
    ];
    expect(sortedTitles(records, 'lastWatchedAt', false)).toEqual([
      'C',
      'A',
      'B',
    ]);
    expect(sortedTitles(records, 'lastWatchedAt', true)).toEqual([
      'A',
      'C',
      'B',
    ]);
  });

  it('名称排序：升序按标题排列，相等时回落基线顺序（最近观看降序）', () => {
    const records = [
      record({ key: 'a+1', title: 'b剧', save_time: 100 }),
      record({ key: 'b+1', title: 'a剧', save_time: 200 }),
      record({ key: 'c+1', title: 'a剧', save_time: 300 }),
    ];
    expect(sortedTitles(records, 'title', true)).toEqual(['a剧', 'a剧', 'b剧']);
    // 两个 a剧 保持基线顺序（save_time 降序：c 在 b 前）
    expect(
      sortContinueWatchingRecords(records, {
        type: 'title',
        ascending: true,
      }).map((item) => item.key),
    ).toEqual(['c+1', 'b+1', 'a+1']);
  });

  it('观看进度排序：按进度比例排列，无总时长的排最后', () => {
    const records = [
      record({ key: 'a+1', title: 'A', play_time: 600, total_time: 1200 }), // 50%
      record({ key: 'b+1', title: 'B', play_time: 300, total_time: 1200 }), // 25%
      record({ key: 'c+1', title: 'C', play_time: 100, total_time: 0 }), // 无总时长
    ];
    expect(sortedTitles(records, 'watchProgress', false)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(sortedTitles(records, 'watchProgress', true)).toEqual([
      'B',
      'A',
      'C',
    ]);
  });

  it('剩余时间排序：剩余多的在前（降序）', () => {
    const records = [
      record({ key: 'a+1', title: 'A', play_time: 900, total_time: 1200 }), // 剩 300
      record({ key: 'b+1', title: 'B', play_time: 300, total_time: 1200 }), // 剩 900
    ];
    expect(sortedTitles(records, 'remainingTime', false)).toEqual(['B', 'A']);
    expect(sortedTitles(records, 'remainingTime', true)).toEqual(['A', 'B']);
  });

  it('更新时间排序：有更新的恒在最前，方向只决定组内顺序', () => {
    const records = [
      record({ key: 'a+1', title: 'A', save_time: 100 }),
      record({ key: 'b+1', title: 'B', save_time: 200 }),
      record({ key: 'c+1', title: 'C', save_time: 300 }),
      record({ key: 'd+1', title: 'D', save_time: 400 }),
    ];
    const updates = [
      updateItem({ key: 'a+1', newEpisodes: 1, detectedAt: 1000 }),
      updateItem({ key: 'c+1', newEpisodes: 2, detectedAt: 2000 }),
    ];
    // 降序（update_first）：有更新组内新加入在前（C 先于 A），无更新组保持基线顺序
    expect(
      sortedTitles(records, 'continueWatchingUpdate', false, updates),
    ).toEqual(['C', 'A', 'D', 'B']);
    // 升序（update_last）：有更新组仍在最前，但组内新加入在后（A 先于 C）
    expect(
      sortedTitles(records, 'continueWatchingUpdate', true, updates),
    ).toEqual(['A', 'C', 'D', 'B']);
  });

  it('更新时间排序：检测时间未知的有更新项排在有时间的之后，且更新集数多的在前', () => {
    const records = [
      record({ key: 'a+1', title: 'A', save_time: 100 }),
      record({ key: 'b+1', title: 'B', save_time: 200 }),
      record({ key: 'c+1', title: 'C', save_time: 300 }),
    ];
    const updates = [
      updateItem({ key: 'a+1', newEpisodes: 3 }), // 无 detectedAt
      updateItem({ key: 'b+1', newEpisodes: 1, detectedAt: 5000 }),
    ];
    // A 无检测时间恒排在 B 之后（两个方向一致），C 无更新保持基线顺序
    for (const ascending of [false, true]) {
      expect(
        sortedTitles(records, 'continueWatchingUpdate', ascending, updates),
      ).toEqual(['B', 'A', 'C']);
    }
  });

  it('更新集数排序：有更新组内按新增集数排列，方向生效', () => {
    const records = [
      record({ key: 'a+1', title: 'A', save_time: 100 }),
      record({ key: 'b+1', title: 'B', save_time: 200 }),
      record({ key: 'c+1', title: 'C', save_time: 300 }),
      record({ key: 'd+1', title: 'D', save_time: 400 }),
    ];
    const updates = [
      updateItem({ key: 'a+1', newEpisodes: 5, detectedAt: 1000 }),
      updateItem({ key: 'c+1', newEpisodes: 1, detectedAt: 2000 }),
    ];
    // 降序：更新集数多的在前；升序：少的在前；无更新组始终在后保持基线顺序
    expect(
      sortedTitles(records, 'continueWatchingNewEpisodeCount', false, updates),
    ).toEqual(['A', 'C', 'D', 'B']);
    expect(
      sortedTitles(records, 'continueWatchingNewEpisodeCount', true, updates),
    ).toEqual(['C', 'A', 'D', 'B']);
  });

  it('无新集数（hasNewEpisode=false 或 newEpisodes=0）的更新项不参与分组置顶', () => {
    const records = [
      record({ key: 'a+1', title: 'A', save_time: 100 }),
      record({ key: 'b+1', title: 'B', save_time: 200 }),
    ];
    const updates = [
      updateItem({ key: 'a+1', newEpisodes: 0, hasNewEpisode: false }),
      updateItem({ key: 'b+1', newEpisodes: 0, hasNewEpisode: false }),
    ];
    expect(
      sortedTitles(records, 'continueWatchingUpdate', false, updates),
    ).toEqual(['B', 'A']);
  });

  it('非分组排序不受更新数据影响', () => {
    const records = [
      record({ key: 'a+1', title: 'B', save_time: 100 }),
      record({ key: 'b+1', title: 'A', save_time: 200 }),
    ];
    const updates = [updateItem({ key: 'a+1', newEpisodes: 9, detectedAt: 1 })];
    expect(sortedTitles(records, 'title', true, updates)).toEqual(['A', 'B']);
  });
});
