import type { PlayRecord, WatchingFollow } from '@/lib/types';
import { watchingFollowKey } from '@/lib/api/watching-follow';
import { playRecordStorageKey } from '@/lib/play-record';
import {
  calculateWatchingUpdate,
  resolveEffectiveOriginalEpisodes,
  watchedEpisodesForRecord,
} from '@/lib/watching-update-calculation';

import {
  buildWatchingFollowCandidates,
  calculateWatchingFollowEpisodeState,
} from './useWatchingUpdates';

describe('WatchingFollow update detection candidates', () => {
  it('detects an update when both WatchingFollow and PlayRecord exist', () => {
    const follow = createFollow({ originalEpisodes: 10 });
    const candidates = buildWatchingFollowCandidates(
      { [watchingFollowKey('source-a', 'video-1')]: follow },
      [createRecord()],
    );

    expect(candidates).toHaveLength(1);
    expect(
      calculateWatchingFollowEpisodeState(
        12,
        candidates[0].follow.originalEpisodes,
        8,
        candidates[0].record.total_episodes,
      ),
    ).toMatchObject({ hasUpdate: true, newEpisodes: 2 });
  });

  it('does not create a candidate when a Follow has no PlayRecord', () => {
    const follow = createFollow();

    expect(
      buildWatchingFollowCandidates(
        { [watchingFollowKey('source-a', 'video-1')]: follow },
        [],
      ),
    ).toEqual([]);
  });

  it('does not detect a PlayRecord or legacy Reminder without a Follow', () => {
    expect(buildWatchingFollowCandidates({}, [createRecord()])).toEqual([]);
  });

  it('uses WatchingFollow.originalEpisodes as the update baseline', () => {
    const follow = createFollow({ originalEpisodes: 10 });
    const record = createRecord({ original_episodes: 2 });
    const [candidate] = buildWatchingFollowCandidates(
      { [watchingFollowKey('source-a', 'video-1')]: follow },
      [record],
    );

    const state = calculateWatchingFollowEpisodeState(
      12,
      candidate.follow.originalEpisodes,
      8,
      candidate.record.total_episodes,
    );

    expect(state.newEpisodes).toBe(2);
  });

  it('ignores changes to PlayRecord.original_episodes', () => {
    const follow = createFollow({ originalEpisodes: 10 });
    const firstRecord = createRecord({ original_episodes: 1 });
    const secondRecord = createRecord({ original_episodes: 99 });

    const calculate = (record: PlayRecord & { key: string }) => {
      const [candidate] = buildWatchingFollowCandidates(
        { [watchingFollowKey('source-a', 'video-1')]: follow },
        [record],
      );
      return calculateWatchingFollowEpisodeState(
        12,
        candidate.follow.originalEpisodes,
        8,
        candidate.record.total_episodes,
      );
    };

    expect(calculate(firstRecord)).toEqual(calculate(secondRecord));
  });

  it('removes the candidate after the WatchingFollow is cancelled', () => {
    const follow = createFollow();
    const records = [createRecord()];

    expect(
      buildWatchingFollowCandidates(
        { [watchingFollowKey('source-a', 'video-1')]: follow },
        records,
      ),
    ).toHaveLength(1);
    expect(buildWatchingFollowCandidates({}, records)).toEqual([]);
    expect(
      buildWatchingFollowCandidates(
        {
          [watchingFollowKey('source-a', 'video-1')]: createFollow({
            enabled: false,
          }),
        },
        records,
      ),
    ).toEqual([]);
  });

  it('uses record total as latest protection when detail temporarily regresses', () => {
    expect(calculateWatchingFollowEpisodeState(8, 10, 6, 12)).toMatchObject({
      hasUpdate: true,
      newEpisodes: 2,
      protectedTotalEpisodes: 12,
      remainingEpisodes: 6,
    });
  });

  it('does not report an update when watched episodes catch up to latest', () => {
    expect(calculateWatchingFollowEpisodeState(12, 10, 12, 12)).toMatchObject({
      hasUpdate: false,
      newEpisodes: 0,
      remainingEpisodes: 0,
      baselineEpisodes: 12,
    });
  });

  it('calculates final episode fields from normalized inputs', () => {
    expect(
      calculateWatchingUpdate({
        detailEpisodes: '12',
        originalEpisodes: 10,
        recordTotalEpisodes: Number.NaN,
        watchedEpisodes: 11,
      }),
    ).toEqual({
      latestEpisodes: 12,
      watchedEpisodes: 11,
      baselineEpisodes: 11,
      newEpisodes: 1,
      remainingEpisodes: 1,
      hasUpdate: true,
    });
  });

  it('resolves original episodes from the Follow baseline first', () => {
    expect(resolveEffectiveOriginalEpisodes(12, 24, 5)).toBe(12);
  });

  it('falls back to detail episodes when the Follow baseline is invalid', () => {
    expect(resolveEffectiveOriginalEpisodes(0, 24, 5)).toBe(24);
  });

  it('falls back to recorded total episodes when detail episodes are invalid', () => {
    expect(resolveEffectiveOriginalEpisodes(0, 0, 5)).toBe(5);
  });

  it('uses one as the final original episode fallback', () => {
    expect(resolveEffectiveOriginalEpisodes(0, 0, 0)).toBe(1);
  });

  it('uses the resolved baseline throughout update calculations', () => {
    expect(
      calculateWatchingUpdate({
        detailEpisodes: 24,
        originalEpisodes: 0,
        recordTotalEpisodes: 5,
        watchedEpisodes: 5,
      }),
    ).toMatchObject({
      latestEpisodes: 24,
      baselineEpisodes: 24,
      newEpisodes: 0,
      remainingEpisodes: 19,
    });
  });

  it('applies the completion threshold before deriving watched episodes', () => {
    const record = createRecord({ index: 8, play_time: 400, total_time: 1000 });

    expect(watchedEpisodesForRecord(record, 0)).toBe(8);
    expect(watchedEpisodesForRecord(record, 50)).toBe(7);
    expect(watchedEpisodesForRecord(record, 80)).toBe(7);
    expect(watchedEpisodesForRecord(record, 100)).toBe(7);
    expect(
      watchedEpisodesForRecord(
        createRecord({ index: 8, play_time: 500, total_time: 1000 }),
        50,
      ),
    ).toBe(8);
    expect(
      watchedEpisodesForRecord(
        createRecord({ index: 8, play_time: 1000, total_time: 1000 }),
        100,
      ),
    ).toBe(8);
    expect(
      watchedEpisodesForRecord(
        createRecord({ index: 9, play_time: 1, total_time: 1000 }),
        100,
      ),
    ).toBe(8);
  });

  it('maps a legacy source name to the Follow source key', () => {
    const follow = createFollow();
    const record = createRecord({ key: 'Source A+video-1' });

    expect(
      buildWatchingFollowCandidates(
        { [watchingFollowKey('source-a', 'video-1')]: follow },
        [record],
        new Map([['Source A', 'source-a']]),
      ),
    ).toHaveLength(1);
  });

  it('preserves plus signs in PlayRecord ids when joining candidates', () => {
    const follow = createFollow({ id: 'video+1' });
    const record = createRecord({
      key: playRecordStorageKey('source-a', 'video+1'),
    });

    expect(
      buildWatchingFollowCandidates(
        { [watchingFollowKey('source-a', 'video+1')]: follow },
        [record],
      ),
    ).toHaveLength(1);
  });
});

function createFollow(overrides: Partial<WatchingFollow> = {}): WatchingFollow {
  return {
    source: 'source-a',
    id: 'video-1',
    title: 'Demo',
    cover: 'cover.jpg',
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
  overrides: Partial<PlayRecord & { key: string }> = {},
): PlayRecord & { key: string } {
  return {
    key: playRecordStorageKey('source-a', 'video-1'),
    title: 'Demo',
    source_name: 'Source A',
    cover: 'cover.jpg',
    year: '2026',
    index: 8,
    total_episodes: 10,
    original_episodes: 10,
    play_time: 120,
    total_time: 1200,
    save_time: 1,
    search_title: 'Demo',
    ...overrides,
  };
}
