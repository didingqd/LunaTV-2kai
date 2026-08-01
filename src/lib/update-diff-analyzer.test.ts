import { UpdateDiffAnalyzer } from './update-diff-analyzer';

const checkedAt = new Date('2026-07-31T13:30:00.000Z').getTime();

describe('UpdateDiffAnalyzer', () => {
  const analyzer = new UpdateDiffAnalyzer();

  it('sends the first computed update from the candidate baseline', () => {
    const result = analyzer.analyze(
      [
        {
          followId: 'one-piece',
          title: '海贼王',
          fromEpisode: 12,
          toEpisode: 14,
          hasUpdate: true,
        },
      ],
      { snapshots: [], history: [] },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([
      {
        followId: 'one-piece',
        title: '海贼王',
        fromEpisode: 12,
        toEpisode: 14,
      },
    ]);
    expect(result.nextState).toEqual({
      snapshots: [{ followId: 'one-piece', effectiveLatestEpisode: 14 }],
      history: [
        {
          followId: 'one-piece',
          fromEpisode: 12,
          toEpisode: 14,
          updatedAt: '2026-07-31T13:30:00.000Z',
        },
      ],
    });
  });

  it('ignores a first computed result when no new episode exists', () => {
    const result = analyzer.analyze(
      [
        {
          followId: 'one-piece',
          title: '海贼王',
          fromEpisode: 14,
          toEpisode: 14,
          hasUpdate: false,
        },
      ],
      { snapshots: [], history: [] },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([]);
    expect(result.nextState).toEqual({
      snapshots: [],
      history: [],
    });
  });

  it('records the computed episode increase without using the snapshot as the display baseline', () => {
    const result = analyzer.analyze(
      [
        {
          followId: 'one-piece',
          title: '海贼王',
          fromEpisode: 12,
          toEpisode: 14,
          hasUpdate: true,
        },
      ],
      {
        snapshots: [{ followId: 'one-piece', effectiveLatestEpisode: 13 }],
        history: [],
      },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([
      {
        followId: 'one-piece',
        title: '海贼王',
        fromEpisode: 12,
        toEpisode: 14,
      },
    ]);
    expect(result.nextState.history).toEqual([
      {
        followId: 'one-piece',
        fromEpisode: 12,
        toEpisode: 14,
        updatedAt: '2026-07-31T13:30:00.000Z',
      },
    ]);
  });

  it('does not create an update for an unchanged episode and exposes pending updates from current results', () => {
    const result = analyzer.analyze(
      [
        {
          followId: 'one-piece',
          title: '海贼王',
          fromEpisode: 100,
          toEpisode: 101,
          hasUpdate: true,
        },
      ],
      {
        snapshots: [{ followId: 'one-piece', effectiveLatestEpisode: 101 }],
        history: [
          {
            followId: 'one-piece',
            fromEpisode: 100,
            toEpisode: 101,
            updatedAt: '2026-07-31T12:00:00.000Z',
          },
        ],
      },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([]);
    expect(result.pendingUpdates).toEqual([
      {
        followId: 'one-piece',
        title: '海贼王',
        fromEpisode: 100,
        toEpisode: 101,
      },
    ]);
  });

  it('removes history when the current result has no unwatched update', () => {
    const result = analyzer.analyze(
      [
        {
          followId: 'one-piece',
          title: '海贼王',
          fromEpisode: 101,
          toEpisode: 101,
          hasUpdate: false,
        },
      ],
      {
        snapshots: [{ followId: 'one-piece', effectiveLatestEpisode: 101 }],
        history: [
          {
            followId: 'one-piece',
            fromEpisode: 100,
            toEpisode: 101,
            updatedAt: '2026-07-31T12:00:00.000Z',
          },
        ],
      },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([]);
    expect(result.pendingUpdates).toEqual([]);
    expect(result.nextState.history).toEqual([]);
  });

  it('records jump updates and does not lower the snapshot after a provider rollback', () => {
    const result = analyzer.analyze(
      [
        {
          followId: 'one-piece',
          title: '海贼王',
          fromEpisode: 101,
          toEpisode: 105,
          hasUpdate: true,
        },
        {
          followId: 'naruto',
          title: '火影忍者',
          fromEpisode: 105,
          toEpisode: 103,
          hasUpdate: false,
        },
      ],
      {
        snapshots: [
          { followId: 'one-piece', effectiveLatestEpisode: 101 },
          { followId: 'naruto', effectiveLatestEpisode: 105 },
        ],
        history: [],
      },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([
      {
        followId: 'one-piece',
        title: '海贼王',
        fromEpisode: 101,
        toEpisode: 105,
      },
    ]);
    expect(result.nextState.snapshots).toEqual([
      { followId: 'naruto', effectiveLatestEpisode: 105 },
      { followId: 'one-piece', effectiveLatestEpisode: 105 },
    ]);
  });
});
