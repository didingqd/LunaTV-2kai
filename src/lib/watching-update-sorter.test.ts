import type { WatchingUpdateItem } from './watching-update-result';
import { sortWatchingUpdates } from './watching-update-sorter';

describe('WatchingUpdateSorter', () => {
  it('sorts names by complete case-insensitive title', () => {
    const items = [
      item({ title: 'b' }),
      item({ title: 'abc' }),
      item({ title: 'ab' }),
      item({ title: 'a' }),
    ];

    expect(titles(sortWatchingUpdates(items, { field: 'name' }))).toEqual([
      'a',
      'ab',
      'abc',
      'b',
    ]);
  });

  it('keeps case-insensitive title ties stable', () => {
    const items = [
      item({ title: 'Apple' }),
      item({ title: 'apple' }),
      item({ title: 'banana' }),
    ];

    expect(titles(sortWatchingUpdates(items, { field: 'name' }))).toEqual([
      'Apple',
      'apple',
      'banana',
    ]);
  });

  it('sorts episodes and resources', () => {
    const items = [
      item({ title: 'B剧', sourceName: '资源B', newEpisodes: 1 }),
      item({ title: 'A剧', sourceName: '资源A', newEpisodes: 4 }),
      item({ title: '剧B', sourceName: '资源A', newEpisodes: 2 }),
    ];

    expect(
      titles(sortWatchingUpdates([items[0], items[1]], { field: 'name' })),
    ).toEqual(['A剧', 'B剧']);
    expect(
      sortWatchingUpdates(items, { field: 'episodes', order: 'asc' }).map(
        (value) => value.newEpisodes,
      ),
    ).toEqual([1, 2, 4]);
    expect(
      sortWatchingUpdates(items, { field: 'episodes', order: 'desc' }).map(
        (value) => value.newEpisodes,
      ),
    ).toEqual([4, 2, 1]);
    expect(
      sortWatchingUpdates(
        [
          item({ title: '剧C', sourceName: 'Rabbit', sourceKey: 'a_source' }),
          item({ title: '剧B', sourceName: 'Apple', sourceKey: 'z_source' }),
          item({ title: '剧A', sourceName: 'Apple', sourceKey: 'z_source' }),
        ],
        { field: 'resource' },
      ).map((value) => `${value.sourceName}-${value.title}`),
    ).toEqual(['Apple-剧A', 'Apple-剧B', 'Rabbit-剧C']);
  });

  it('sorts detected time newest first and keeps null values last', () => {
    const items = [
      item({ title: '无时间', detectedAt: undefined }),
      item({ title: '旧', detectedAt: 1000 }),
      item({ title: '新', detectedAt: 2000 }),
    ];

    expect(
      titles(sortWatchingUpdates(items, { field: 'detectedTime' })),
    ).toEqual(['新', '旧', '无时间']);
    expect(
      titles(
        sortWatchingUpdates(items, {
          field: 'detectedTime',
          order: 'asc',
        }),
      ),
    ).toEqual(['旧', '新', '无时间']);
  });

  it('produces identical results for local and backend item lists', () => {
    const source = [
      item({ title: 'B', sourceName: 'A', detectedAt: 1000 }),
      item({ title: 'A', sourceName: 'A', detectedAt: 2000 }),
      item({ title: 'C', sourceName: 'B', detectedAt: undefined }),
    ];
    const sort = (items: WatchingUpdateItem[]) =>
      sortWatchingUpdates(items, {
        field: 'detectedTime',
        order: 'desc',
      });

    expect(sort([...source])).toEqual(sort([...source]));
  });
});

function titles(items: WatchingUpdateItem[]) {
  return items.map((item) => item.title);
}

function item(
  overrides: Partial<WatchingUpdateItem> & {
    title: string;
  },
): WatchingUpdateItem {
  return {
    title: overrides.title,
    sourceName: '资源',
    source_name: '资源',
    year: '',
    cover: '',
    identityKey: `key-${overrides.title}`,
    source: 'source',
    id: overrides.title,
    sourceKey: 'source',
    videoId: overrides.title,
    currentEpisode: 1,
    totalEpisodes: 4,
    hasNewEpisode: true,
    hasContinueWatching: false,
    hasNewRelease: false,
    newEpisodes: 1,
    remainingEpisodes: 3,
    releasedEpisodes: 1,
    unwatchedEpisodes: 3,
    latestEpisodes: 4,
    completed: false,
    ...overrides,
  };
}
