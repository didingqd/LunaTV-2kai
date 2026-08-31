/**
 * 收藏排序（favorites-sort）单元测试
 *
 * 修改点：验证与 APP（Selene-Source）favorites_screen / MediaSortEngine 对齐的
 * 排序语义：存储值往返、默认排序、各字段排序、null-last、更新排序 tie-break。
 */

import { buildContentIdentityKey } from './content-identity';
import {
  DEFAULT_FAVORITES_SORT_SELECTION,
  FAVORITES_SORT_OPTIONS,
  favoritesSortDefaultAscending,
  favoritesSortDirectionLabel,
  type FavoritesSortItem,
  favoritesSortLabel,
  favoritesSortSelectionFromStorageValue,
  favoritesSortStorageValue,
  sortFavorites,
} from './favorites-sort';
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

type TestFavorite = FavoritesSortItem & { key: string };

const FAVORITE_SOURCE = 'src';

function favorite(
  key: string,
  overrides: Partial<FavoritesSortItem> = {},
): TestFavorite {
  return {
    // 修改点：使用与追更检测项（sourceKey/videoId）一致的 canonical 身份 key，
    // 与生产链路（mapFavoriteReminderIdentityItem 的 identityKey）同构
    identityKey: buildContentIdentityKey(FAVORITE_SOURCE, key),
    title: key,
    sourceName: '源A',
    year: '2024',
    releaseDate: null,
    saveTime: 1000,
    lastWatchedAt: null,
    watchProgress: null,
    remainingTime: null,
    ...overrides,
    key,
  };
}

const titlesOf = (items: readonly { key: string }[]) => items.map((i) => i.key);

describe('favorites-sort 存储值', () => {
  it('存储值往返保持一致（type:asc|desc，与 APP 通用格式一致）', () => {
    for (const type of FAVORITES_SORT_OPTIONS) {
      for (const ascending of [true, false]) {
        const selection = { type, ascending };
        expect(
          favoritesSortSelectionFromStorageValue(
            favoritesSortStorageValue(selection),
          ),
        ).toEqual(selection);
      }
    }
  });

  it('空值与非法值回落默认排序（保存时间降序）', () => {
    expect(favoritesSortSelectionFromStorageValue(null)).toEqual(
      DEFAULT_FAVORITES_SORT_SELECTION,
    );
    expect(favoritesSortSelectionFromStorageValue('')).toEqual(
      DEFAULT_FAVORITES_SORT_SELECTION,
    );
    expect(favoritesSortSelectionFromStorageValue('nonsense')).toEqual(
      DEFAULT_FAVORITES_SORT_SELECTION,
    );
    // 未支持的排序字段（继续观看专用字段）同样回落
    expect(
      favoritesSortSelectionFromStorageValue('continueWatchingUpdate:asc'),
    ).toEqual(DEFAULT_FAVORITES_SORT_SELECTION);
    // 非法方向回落
    expect(favoritesSortSelectionFromStorageValue('title:up')).toEqual(
      DEFAULT_FAVORITES_SORT_SELECTION,
    );
  });
});

describe('favorites-sort 元数据', () => {
  it('标签与默认方向与 APP 一致', () => {
    expect(favoritesSortLabel('savedAt')).toBe('保存时间');
    expect(favoritesSortLabel('newEpisodeCount')).toBe('更新集数');
    expect(favoritesSortLabel('updateDetectedAt')).toBe('更新时间');
    expect(favoritesSortLabel('source')).toBe('资源');
    // 仅名称/资源默认升序，其余默认降序
    expect(favoritesSortDefaultAscending('title')).toBe(true);
    expect(favoritesSortDefaultAscending('source')).toBe(true);
    expect(favoritesSortDefaultAscending('savedAt')).toBe(false);
    expect(favoritesSortDefaultAscending('releaseDate')).toBe(false);
  });

  it('方向文案与 APP 一致', () => {
    expect(favoritesSortDirectionLabel('savedAt', false)).toBe('最近保存');
    expect(favoritesSortDirectionLabel('savedAt', true)).toBe('最早保存');
    expect(favoritesSortDirectionLabel('updateDetectedAt', false)).toBe(
      '新加入在前',
    );
    expect(favoritesSortDirectionLabel('title', true)).toBe('从A到Z');
    expect(favoritesSortDirectionLabel('year', false)).toBe('从新到旧');
  });
});

describe('sortFavorites 排序行为', () => {
  it('默认排序（保存时间降序）与原 Web「最近添加」一致', () => {
    const items = [
      favorite('A', { saveTime: 100 }),
      favorite('B', { saveTime: 300 }),
      favorite('C', { saveTime: 200 }),
    ];
    expect(
      titlesOf(sortFavorites(items, DEFAULT_FAVORITES_SORT_SELECTION)),
    ).toEqual(['B', 'C', 'A']);
  });

  it('保存时间升序 + saveTime 缺失恒排最后', () => {
    const items = [
      favorite('A', { saveTime: 100 }),
      favorite('B', { saveTime: null }),
      favorite('C', { saveTime: 300 }),
    ];
    expect(
      titlesOf(sortFavorites(items, { type: 'savedAt', ascending: true })),
    ).toEqual(['A', 'C', 'B']);
  });

  it('最近观看：无播放记录（null）恒最后，降序新在前', () => {
    const items = [
      favorite('A', { lastWatchedAt: 500 }),
      favorite('B', { lastWatchedAt: null }),
      favorite('C', { lastWatchedAt: 900 }),
    ];
    expect(
      titlesOf(
        sortFavorites(items, { type: 'lastWatchedAt', ascending: false }),
      ),
    ).toEqual(['C', 'A', 'B']);
  });

  it('观看进度与剩余时间排序', () => {
    const items = [
      favorite('A', { watchProgress: 0.9, remainingTime: 300 }),
      favorite('B', { watchProgress: 0.2, remainingTime: 100 }),
      favorite('C', { watchProgress: null, remainingTime: null }),
    ];
    expect(
      titlesOf(
        sortFavorites(items, { type: 'watchProgress', ascending: false }),
      ),
    ).toEqual(['A', 'B', 'C']);
    expect(
      titlesOf(
        sortFavorites(items, { type: 'remainingTime', ascending: true }),
      ),
    ).toEqual(['B', 'A', 'C']);
  });

  it('年份与上映时间排序：无法解析的值恒最后', () => {
    const items = [
      favorite('A', { year: '2023', releaseDate: '2023-05-01' }),
      favorite('B', { year: '2024', releaseDate: '2024-01-01' }),
      favorite('C', { year: '未知', releaseDate: null }),
    ];
    expect(
      titlesOf(sortFavorites(items, { type: 'year', ascending: false })),
    ).toEqual(['B', 'A', 'C']);
    expect(
      titlesOf(sortFavorites(items, { type: 'releaseDate', ascending: true })),
    ).toEqual(['A', 'B', 'C']);
  });

  it('资源排序：先资源名后名称（APP 复合值）', () => {
    const items = [
      favorite('A', { sourceName: '源B', title: 'Z' }),
      favorite('B', { sourceName: '源A', title: 'M' }),
      favorite('C', { sourceName: '源A', title: 'N' }),
    ];
    expect(
      titlesOf(sortFavorites(items, { type: 'source', ascending: true })),
    ).toEqual(['B', 'C', 'A']);
  });
});

describe('sortFavorites 更新排序（追更数据）', () => {
  const updatedSeries = [
    updateItem('src', 'A', 2, 1000),
    updateItem('src', 'B', 5, 2000),
    updateItem('src', 'D', 0, 3000), // 无更新：不应参与更新排序
  ];

  it('更新集数：有更新的在前，降序多的在前；无更新按保存时间兜底', () => {
    const items = [
      favorite('A', { saveTime: 300 }),
      favorite('B', { saveTime: 100 }),
      favorite('C', { saveTime: 200 }), // 无更新
    ];
    expect(
      titlesOf(
        sortFavorites(
          items,
          { type: 'newEpisodeCount', ascending: false },
          updatedSeries,
        ),
      ),
    ).toEqual(['B', 'A', 'C']);
    // 升序：有更新的仍在前（null-last），组内从少到多
    expect(
      titlesOf(
        sortFavorites(
          items,
          { type: 'newEpisodeCount', ascending: true },
          updatedSeries,
        ),
      ),
    ).toEqual(['A', 'B', 'C']);
  });

  it('更新时间：检测时间新的在前；无更新（null）恒最后', () => {
    const items = [
      favorite('A', { saveTime: 300 }),
      favorite('B', { saveTime: 100 }),
      favorite('C', { saveTime: 200 }),
    ];
    expect(
      titlesOf(
        sortFavorites(
          items,
          { type: 'updateDetectedAt', ascending: false },
          updatedSeries,
        ),
      ),
    ).toEqual(['B', 'A', 'C']);
  });

  it('更新集数主值相等时，tie-break 按更新时间新的在前（方向固定）', () => {
    const sameCountUpdates = [
      updateItem('src', 'A', 3, 1000),
      updateItem('src', 'B', 3, 2000),
    ];
    const items = [
      favorite('A', { saveTime: 100 }),
      favorite('B', { saveTime: 200 }),
    ];
    // 集数相同（3==3）→ 次级排序按 detectedAt 降序：B(2000) 在 A(1000) 前
    expect(
      titlesOf(
        sortFavorites(
          items,
          { type: 'newEpisodeCount', ascending: false },
          sameCountUpdates,
        ),
      ),
    ).toEqual(['B', 'A']);
    // 升序时 tie-break 方向同样固定（不随主排序反转）
    expect(
      titlesOf(
        sortFavorites(
          items,
          { type: 'newEpisodeCount', ascending: true },
          sameCountUpdates,
        ),
      ),
    ).toEqual(['B', 'A']);
  });

  it('更新时间主值相等（批量检测）时，tie-break 按更新集数多的在前，再回落保存时间', () => {
    const sameTimeUpdates = [
      updateItem('src', 'A', 2, 5000),
      updateItem('src', 'B', 4, 5000),
      updateItem('src', 'C', 4, 5000),
    ];
    const items = [
      favorite('A', { saveTime: 900 }),
      favorite('B', { saveTime: 100 }),
      favorite('C', { saveTime: 300 }),
    ];
    // 同一检测时间：B/C（4集）按保存时间降序在前，A（2集）最后
    expect(
      titlesOf(
        sortFavorites(
          items,
          { type: 'updateDetectedAt', ascending: false },
          sameTimeUpdates,
        ),
      ),
    ).toEqual(['C', 'B', 'A']);
  });

  it('无追更数据时，更新排序退化为保存时间基线顺序（不报错）', () => {
    const items = [
      favorite('A', { saveTime: 100 }),
      favorite('B', { saveTime: 300 }),
    ];
    expect(
      titlesOf(
        sortFavorites(
          items,
          { type: 'newEpisodeCount', ascending: false },
          null,
        ),
      ),
    ).toEqual(['B', 'A']);
  });
});
