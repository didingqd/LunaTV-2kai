import type { PlayRecord, WatchingFollow } from '@/lib/types';

import {
  buildWatchingFollowCandidates,
  calculateWatchingFollowEpisodeState,
} from './useWatchingUpdates';

describe('WatchingFollow update detection candidates', () => {
  it('detects an update when both WatchingFollow and PlayRecord exist', () => {
    const follow = createFollow({ originalEpisodes: 10 });
    const candidates = buildWatchingFollowCandidates(
      { 'source-a+video-1': follow },
      [createRecord()],
    );

    expect(candidates).toHaveLength(1);
    expect(
      calculateWatchingFollowEpisodeState(
        12,
        candidates[0].follow.originalEpisodes,
        candidates[0].record.index,
        candidates[0].record.total_episodes,
      ),
    ).toMatchObject({ hasUpdate: true, newEpisodes: 2 });
  });

  it('does not create a candidate when a Follow has no PlayRecord', () => {
    const follow = createFollow();

    expect(
      buildWatchingFollowCandidates({ 'source-a+video-1': follow }, []),
    ).toEqual([]);
  });

  it('does not detect a PlayRecord or legacy Reminder without a Follow', () => {
    expect(buildWatchingFollowCandidates({}, [createRecord()])).toEqual([]);
  });

  it('uses WatchingFollow.originalEpisodes as the update baseline', () => {
    const follow = createFollow({ originalEpisodes: 10 });
    const record = createRecord({ original_episodes: 2 });
    const [candidate] = buildWatchingFollowCandidates(
      { 'source-a+video-1': follow },
      [record],
    );

    const state = calculateWatchingFollowEpisodeState(
      12,
      candidate.follow.originalEpisodes,
      candidate.record.index,
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
        { 'source-a+video-1': follow },
        [record],
      );
      return calculateWatchingFollowEpisodeState(
        12,
        candidate.follow.originalEpisodes,
        candidate.record.index,
        candidate.record.total_episodes,
      );
    };

    expect(calculate(firstRecord)).toEqual(calculate(secondRecord));
  });

  it('removes the candidate after the WatchingFollow is cancelled', () => {
    const follow = createFollow();
    const records = [createRecord()];

    expect(
      buildWatchingFollowCandidates({ 'source-a+video-1': follow }, records),
    ).toHaveLength(1);
    expect(buildWatchingFollowCandidates({}, records)).toEqual([]);
    expect(
      buildWatchingFollowCandidates(
        {
          'source-a+video-1': createFollow({ enabled: false }),
        },
        records,
      ),
    ).toEqual([]);
  });

  it('keeps the maximum episode count when detail temporarily regresses', () => {
    expect(calculateWatchingFollowEpisodeState(8, 10, 6, 12)).toMatchObject({
      hasUpdate: false,
      newEpisodes: 0,
      protectedTotalEpisodes: 12,
      remainingEpisodes: 6,
    });
  });

  it('maps a legacy source name to the Follow source key', () => {
    const follow = createFollow();
    const record = createRecord({ key: 'Source A+video-1' });

    expect(
      buildWatchingFollowCandidates(
        { 'source-a+video-1': follow },
        [record],
        new Map([['Source A', 'source-a']]),
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
    key: 'source-a+video-1',
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
