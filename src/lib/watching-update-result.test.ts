import { watchingFollowKey } from './api/watching-follow';
import {
  mapWatchingUpdateItem,
  normalizeWatchingUpdate,
  resolveNewEpisodeNumbers,
} from './watching-update-result';
import type { WatchingUpdateCalculationResult } from './watching-update-calculation';
import type { PlayRecord, WatchingFollow } from './types';

describe('WatchingUpdate result mapping', () => {
  it('expands the existing update state into the latest episode numbers', () => {
    expect([
      ...resolveNewEpisodeNumbers(
        {
          hasNewEpisode: true,
          latestEpisodes: 12,
          newEpisodes: 2,
        },
        12,
      ),
    ]).toEqual([11, 12]);
  });

  it('does not mark episodes when the existing state is not a new update', () => {
    expect(
      resolveNewEpisodeNumbers(
        {
          hasNewEpisode: false,
          latestEpisodes: 12,
          newEpisodes: 2,
        },
        12,
      ).size,
    ).toBe(0);
  });

  it('clips update episode numbers to the loaded episode list', () => {
    expect([
      ...resolveNewEpisodeNumbers(
        {
          hasNewEpisode: true,
          latestEpisodes: 12,
          newEpisodes: 2,
        },
        11,
      ),
    ]).toEqual([11]);
  });

  it('maps completed and episode aliases from the existing calculation', () => {
    const item = mapWatchingUpdateItem({
      follow: createFollow(),
      record: createRecord(),
      detail: {},
      calculation: createCalculation({
        latestEpisodes: 12,
        watchedEpisodes: 12,
        baselineEpisodes: 12,
        newEpisodes: 2,
        remainingEpisodes: 0,
      }),
    });

    expect(item.completed).toBe(true);
    expect(item.releasedEpisodes).toBe(item.newEpisodes);
    expect(item.releasedEpisodes).toBe(2);
    expect(item.unwatchedEpisodes).toBe(item.remainingEpisodes);
    expect(item.unwatchedEpisodes).toBe(0);
  });

  it('maps and normalizes optional detectedAt', () => {
    const item = mapWatchingUpdateItem({
      follow: createFollow(),
      record: createRecord(),
      detail: {},
      calculation: createCalculation(),
      detectedAt: 1234,
    });

    expect(item.detectedAt).toBe(1234);
    expect(
      normalizeWatchingUpdate({
        hasUpdates: true,
        timestamp: 1,
        updatedSeries: [{ ...item, detectedAt: '2345' }],
      })?.updatedSeries[0].detectedAt,
    ).toBe(2345);
  });

  it('maps record and detail dates to their separate result fields', () => {
    const item = mapWatchingUpdateItem({
      follow: createFollow(),
      record: createRecord({ releaseDate: '2026-01-02' }),
      detail: { releaseDate: '2026-03-04' },
      calculation: createCalculation(),
    });

    expect(item.releaseDate).toBe('2026-01-02');
    expect(item.detailDate).toBe('2026-03-04');
  });

  it('falls back from Follow metadata to PlayRecord and Detail metadata', () => {
    const item = mapWatchingUpdateItem({
      follow: createFollow({ title: '', cover: '', year: '' }),
      record: createRecord({
        title: 'Record title',
        cover: '',
        year: '',
        source_name: 'Record source',
      }),
      detail: {
        title: 'Detail title',
        cover: 'detail-cover.jpg',
        year: '2025',
        source_name: 'Detail source',
      },
      calculation: createCalculation(),
    });

    expect(item.title).toBe('Record title');
    expect(item.cover).toBe('detail-cover.jpg');
    expect(item.year).toBe('2025');
    expect(item.sourceName).toBe('Record source');
    expect(item.source_name).toBe('Record source');
  });

  it('preserves special source and id values with a canonical identity key', () => {
    const source = 'a+b / 中文';
    const id = '123+456 / 空 格';
    const item = mapWatchingUpdateItem({
      follow: createFollow({ source, id }),
      record: createRecord(),
      detail: {},
      calculation: createCalculation(),
    });

    expect(item.source).toBe(source);
    expect(item.id).toBe(id);
    expect(item.sourceKey).toBe(source);
    expect(item.videoId).toBe(id);
    expect(item.identityKey).toBe(watchingFollowKey(source, id));
  });

  it('normalizes legacy cached results without deleting compatibility fields', () => {
    const normalized = normalizeWatchingUpdate({
      hasUpdates: true,
      timestamp: 123,
      updatedCount: 1,
      continueWatchingCount: 0,
      newReleasesCount: 0,
      updatedSeries: [
        {
          title: 'Legacy item',
          source_name: 'Legacy source',
          year: '2024',
          cover: 'legacy-cover.jpg',
          sourceKey: 'source+a',
          videoId: 'video+1',
          currentEpisode: 10,
          totalEpisodes: 12,
          hasNewEpisode: true,
          hasContinueWatching: false,
          hasNewRelease: false,
          newEpisodes: 2,
          remainingEpisodes: 2,
          releasedEpisodes: 99,
          unwatchedEpisodes: 98,
          completed: true,
          detectedAt: 1234,
          releaseDate: '2024-01-01',
        },
      ],
    });

    expect(normalized).toBeDefined();
    expect(normalized?.updatedSeries).toHaveLength(1);
    expect(normalized?.updatedSeries[0]).toMatchObject({
      source: 'source+a',
      id: 'video+1',
      sourceName: 'Legacy source',
      source_name: 'Legacy source',
      sourceKey: 'source+a',
      videoId: 'video+1',
      identityKey: watchingFollowKey('source+a', 'video+1'),
      latestEpisodes: 12,
      newEpisodes: 2,
      remainingEpisodes: 2,
      releasedEpisodes: 2,
      unwatchedEpisodes: 2,
      completed: false,
      detectedAt: 1234,
      releaseDate: '2024-01-01',
    });
    expect(normalized?.updatedSeries[0].detailDate).toBeUndefined();
  });
});

function createFollow(overrides: Partial<WatchingFollow> = {}): WatchingFollow {
  return {
    source: 'source-a',
    id: 'video-1',
    title: 'Follow title',
    cover: 'follow-cover.jpg',
    year: '2026',
    type: 'tv',
    originalEpisodes: 10,
    createdAt: 1,
    updatedAt: 1,
    enabled: true,
    ...overrides,
  };
}

function createRecord(
  overrides: Partial<
    PlayRecord & { source?: string; releaseDate?: string }
  > = {},
): PlayRecord & { source?: string; releaseDate?: string } {
  return {
    title: 'Record title',
    source_name: 'Record source',
    cover: 'record-cover.jpg',
    year: '2026',
    index: 10,
    total_episodes: 12,
    original_episodes: 10,
    play_time: 1200,
    total_time: 1200,
    save_time: 1,
    search_title: 'Record title',
    ...overrides,
  };
}

function createCalculation(
  overrides: Partial<WatchingUpdateCalculationResult> = {},
): WatchingUpdateCalculationResult {
  return {
    latestEpisodes: 12,
    watchedEpisodes: 10,
    baselineEpisodes: 10,
    newEpisodes: 2,
    remainingEpisodes: 2,
    hasUpdate: true,
    ...overrides,
  };
}
