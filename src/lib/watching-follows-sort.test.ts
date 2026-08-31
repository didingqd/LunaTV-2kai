/**
 * 追更列表排序（watching-follows-sort）单元测试
 *
 * 修改点：验证与 APP（Selene-Source）ReminderListScreen / MediaSortEngine 对齐的
 * 排序语义：存储值往返、默认排序、各字段排序、null-last、更新排序 tie-break。
 */

import { buildContentIdentityKey } from './content-identity';
import type { WatchingFollow } from './types';
import {
  DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION,
  sortWatchingFollows,
  WATCHING_FOLLOWS_SORT_OPTIONS,
  watchingFollowsSortDefaultAscending,
  watchingFollowsSortDirectionLabel,
  watchingFollowsSortLabel,
  watchingFollowsSortSelectionFromStorageValue,
  watchingFollowsSortStorageValue,
} from './watching-follows-sort';
import type { WatchingUpdateItem } from './watching-update-result';

// 追更检测项工厂：仅填排序所需的身份与更新字段
function updateItem(
  source: string,
  id: string,
  newEpisodes: number,
  detectedAt?: number,
): WatchingUpdateItem {
  return {
    sourceKey: source,
    videoId: id,
    title: `${source}-${id}`,
    source_name: source,
    currentEpisode: 1,
    totalEpisodes: 12,
    hasNewEpisode: newEpisodes > 0,
    newEpisodes,
    latestEpisodes: 12,
    detectedAt,
  } as WatchingUpdateItem;
}

const FOLLOWS_SOURCE = 'src';

function follow(
  key: string,
  overrides: Partial<WatchingFollow> = {},
): WatchingFollow {
  return {
    source: FOLLOWS_SOURCE,
    id: key,
    title: key,
    cover: '',
    year: '2024',
    type: 'tv',
    originalEpisodes: 1,
    createdAt: 1000,
    updatedAt: 1000,
    enabled: true,
    ...overrides,
  };
}

const namesOf = (items: readonly WatchingFollow[]) =>
  items.map((item) => item.title);

describe('watching-follows-sort 存储值', () => {
  it('存储值往返保持一致（type:asc|desc，与 APP 通用格式一致）', () => {
    for (const type of WATCHING_FOLLOWS_SORT_OPTIONS) {
      for (const ascending of [true, false]) {
        const selection = { type, ascending };
        expect(
          watchingFollowsSortSelectionFromStorageValue(
            watchingFollowsSortStorageValue(selection),
          ),
        ).toEqual(selection);
      }
    }
  });

  it('非法存储值回落默认排序（保存时间降序）', () => {
    for (const invalid of [
      null,
      undefined,
      '',
      'nonsense',
      'savedAt',
      'savedAt:up',
      'unknown:desc',
      'title:asc:extra',
    ]) {
      expect(watchingFollowsSortSelectionFromStorageValue(invalid)).toEqual(
        DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION,
      );
    }
  });

  it('元数据文案与 APP 一致', () => {
    expect(watchingFollowsSortLabel('savedAt')).toBe('保存时间');
    expect(watchingFollowsSortLabel('newEpisodeCount')).toBe('更新集数');
    expect(watchingFollowsSortLabel('updateDetectedAt')).toBe('更新时间');
    expect(watchingFollowsSortLabel('title')).toBe('名称');
    expect(watchingFollowsSortLabel('year')).toBe('年份');
    // 仅「名称」默认升序（与 APP defaultAscending 一致）
    expect(watchingFollowsSortDefaultAscending('title')).toBe(true);
    expect(watchingFollowsSortDefaultAscending('savedAt')).toBe(false);
    expect(watchingFollowsSortDefaultAscending('year')).toBe(false);
    expect(watchingFollowsSortDirectionLabel('title', true)).toBe('从A到Z');
    expect(watchingFollowsSortDirectionLabel('title', false)).toBe('从Z到A');
    expect(watchingFollowsSortDirectionLabel('updateDetectedAt', false)).toBe(
      '新加入在前',
    );
    expect(watchingFollowsSortDirectionLabel('year', true)).toBe('从旧到新');
  });
});

describe('sortWatchingFollows 基础排序', () => {
  it('默认排序：保存时间（createdAt）降序，与原 Web 端顺序一致', () => {
    const items = [
      follow('A', { createdAt: 100 }),
      follow('B', { createdAt: 300 }),
      follow('C', { createdAt: 200 }),
    ];
    expect(
      namesOf(
        sortWatchingFollows(
          items,
          DEFAULT_WATCHING_FOLLOWS_SORT_SELECTION,
          null,
        ),
      ),
    ).toEqual(['B', 'C', 'A']);
  });

  it('保存时间升序：最早加入在前', () => {
    const items = [
      follow('A', { createdAt: 300 }),
      follow('B', { createdAt: 100 }),
      follow('C', { createdAt: 200 }),
    ];
    expect(
      namesOf(
        sortWatchingFollows(items, { type: 'savedAt', ascending: true }, null),
      ),
    ).toEqual(['B', 'C', 'A']);
  });

  it('名称排序：默认升序（A-Z），切换为降序（Z-A）', () => {
    const items = [follow('乙'), follow('甲'), follow('丙')];
    // 拼音序：丙(bing) < 甲(jia) < 乙(yi)，与 APP 的中文拼音感知排序口径一致
    expect(
      namesOf(
        sortWatchingFollows(items, { type: 'title', ascending: true }, null),
      ),
    ).toEqual(['丙', '甲', '乙']);
    expect(
      namesOf(
        sortWatchingFollows(items, { type: 'title', ascending: false }, null),
      ),
    ).toEqual(['乙', '甲', '丙']);
  });

  it('年份排序：数值比较（非字符串），解析失败为 null 恒在后', () => {
    const items = [
      follow('New', { year: '2026' }),
      follow('Old', { year: '1999' }),
      follow('Bad', { year: '未知' }),
    ];
    expect(
      namesOf(
        sortWatchingFollows(items, { type: 'year', ascending: false }, null),
      ),
    ).toEqual(['New', 'Old', 'Bad']);
    expect(
      namesOf(
        sortWatchingFollows(items, { type: 'year', ascending: true }, null),
      ),
    ).toEqual(['Old', 'New', 'Bad']);
  });
});

describe('sortWatchingFollows 更新排序（追更检测数据）', () => {
  const items = [
    follow('A', { createdAt: 100 }), // 无更新
    follow('B', { createdAt: 200, title: 'B' }), // +1，检测于 300
    follow('C', { createdAt: 300, title: 'C' }), // +3，检测于 300（与 B 同批）
    follow('D', { createdAt: 400, title: 'D' }), // +2，检测于 500
  ];
  const updatedSeries = [
    updateItem(FOLLOWS_SOURCE, 'B', 1, 300),
    updateItem(FOLLOWS_SOURCE, 'C', 3, 300),
    updateItem(FOLLOWS_SOURCE, 'D', 2, 500),
  ];

  it('更新集数降序：有更新在前按集数多在前，无更新（0 集）恒在最后', () => {
    expect(
      namesOf(
        sortWatchingFollows(
          items,
          { type: 'newEpisodeCount', ascending: false },
          updatedSeries,
        ),
      ),
    ).toEqual(['C', 'D', 'B', 'A']);
  });

  it('更新集数升序：有更新仍在最前（null-last），组内从少到多', () => {
    expect(
      namesOf(
        sortWatchingFollows(
          items,
          { type: 'newEpisodeCount', ascending: true },
          updatedSeries,
        ),
      ),
    ).toEqual(['B', 'D', 'C', 'A']);
  });

  it('更新集数 tie-break：集数相同时更新时间新的在前（方向固定），再回落保存时间降序', () => {
    // B 与 C 同为一批检测（detectedAt=300），B +1、C +3 -> 更新时间相同时按集数多的在前
    const result = namesOf(
      sortWatchingFollows(
        [follow('B', { createdAt: 200 }), follow('C', { createdAt: 300 })],
        { type: 'newEpisodeCount', ascending: false },
        updatedSeries,
      ),
    );
    expect(result).toEqual(['C', 'B']);
  });

  it('更新时间降序：新加入在前，无更新恒在最后', () => {
    expect(
      namesOf(
        sortWatchingFollows(
          items,
          { type: 'updateDetectedAt', ascending: false },
          updatedSeries,
        ),
      ),
    ).toEqual(['D', 'C', 'B', 'A']);
  });

  it('更新时间升序：有更新仍在最前，组内新加入在后', () => {
    expect(
      namesOf(
        sortWatchingFollows(
          items,
          { type: 'updateDetectedAt', ascending: true },
          updatedSeries,
        ),
      ),
    ).toEqual(['C', 'B', 'D', 'A']);
  });

  it('更新时间 tie-break：同批检测时更新集数多的在前（方向固定）', () => {
    const result = namesOf(
      sortWatchingFollows(
        [follow('B', { createdAt: 200 }), follow('C', { createdAt: 300 })],
        { type: 'updateDetectedAt', ascending: false },
        updatedSeries,
      ),
    );
    expect(result).toEqual(['C', 'B']);
  });

  it('无追更数据时，更新排序退化为保存时间基线顺序（不报错）', () => {
    expect(
      namesOf(
        sortWatchingFollows(
          items,
          { type: 'newEpisodeCount', ascending: false },
          null,
        ),
      ),
    ).toEqual(['D', 'C', 'B', 'A']);
  });

  it('检测项与追更项身份按 canonical key 匹配（sourceKey/videoId ↔ source/id）', () => {
    // 检测项带有的多余字段不影响匹配；不同 source 不串扰
    const otherSourceSeries = [updateItem('other', 'B', 9, 999)];
    expect(
      namesOf(
        sortWatchingFollows(
          [follow('B', { createdAt: 100 })],
          { type: 'newEpisodeCount', ascending: false },
          otherSourceSeries,
        ),
      ),
    ).toEqual(['B']);
  });
});

describe('canonical key 构造', () => {
  it('buildContentIdentityKey 与追更检测项身份一致', () => {
    expect(buildContentIdentityKey(FOLLOWS_SOURCE, 'A')).toBe(
      encodeURIComponent(JSON.stringify([FOLLOWS_SOURCE, 'A'])),
    );
  });
});
