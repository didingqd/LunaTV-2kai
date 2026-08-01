import { UpdateDiffAnalyzer } from './update-diff-analyzer';

const checkedAt = new Date('2026-07-31T13:30:00.000Z').getTime();

describe('UpdateDiffAnalyzer', () => {
  const analyzer = new UpdateDiffAnalyzer();

  it('sends the first computed update from original episodes to the effective latest episode', () => {
    const result = analyzer.analyze(
      [
        {
          followId: 'one-piece',
          title: '海贼王',
          fromEpisode: 12,
          toEpisode: 13,
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
        toEpisode: 13,
      },
    ]);
  });

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
      snapshots: [
        {
          followId: 'one-piece',
          lastNotifiedEffectiveLatestEpisode: 14,
        },
      ],
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
        snapshots: [
          {
            followId: 'one-piece',
            lastNotifiedEffectiveLatestEpisode: 13,
          },
        ],
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

  it('does not create an update for an unchanged episode and exposes already updated items from current results', () => {
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
        snapshots: [
          {
            followId: 'one-piece',
            lastNotifiedEffectiveLatestEpisode: 101,
          },
        ],
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
    expect(result.updated).toEqual([
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
        snapshots: [
          {
            followId: 'one-piece',
            lastNotifiedEffectiveLatestEpisode: 101,
          },
        ],
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
    expect(result.updated).toEqual([]);
    expect(result.nextState.history).toEqual([]);
  });

  it('does not notify or keep updated history after playback catches up', () => {
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
      {
        snapshots: [
          {
            followId: 'one-piece',
            lastNotifiedEffectiveLatestEpisode: 13,
          },
        ],
        history: [
          {
            followId: 'one-piece',
            fromEpisode: 12,
            toEpisode: 13,
            updatedAt: '2026-07-31T12:00:00.000Z',
          },
        ],
      },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.nextState).toEqual({
      snapshots: [
        {
          followId: 'one-piece',
          lastNotifiedEffectiveLatestEpisode: 13,
        },
      ],
      history: [],
    });
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
          {
            followId: 'one-piece',
            lastNotifiedEffectiveLatestEpisode: 101,
          },
          {
            followId: 'naruto',
            lastNotifiedEffectiveLatestEpisode: 105,
          },
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
      { followId: 'naruto', lastNotifiedEffectiveLatestEpisode: 105 },
      { followId: 'one-piece', lastNotifiedEffectiveLatestEpisode: 105 },
    ]);
  });

  it('uses notification snapshot only for dedupe and keeps the computed display baseline', () => {
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
        snapshots: [
          {
            followId: 'one-piece',
            lastNotifiedEffectiveLatestEpisode: 13,
          },
        ],
        history: [
          {
            followId: 'one-piece',
            fromEpisode: 12,
            toEpisode: 13,
            updatedAt: '2026-07-31T12:00:00.000Z',
          },
        ],
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
    expect(result.updated).toEqual([]);
  });

  it('keeps new updates and already updated items in separate sections', () => {
    const result = analyzer.analyze(
      [
        {
          followId: 'a',
          title: 'A',
          fromEpisode: 12,
          toEpisode: 14,
          hasUpdate: true,
        },
      ],
      {
        snapshots: [
          { followId: 'a', lastNotifiedEffectiveLatestEpisode: 13 },
          { followId: 'b', lastNotifiedEffectiveLatestEpisode: 20 },
        ],
        history: [
          {
            followId: 'a',
            fromEpisode: 12,
            toEpisode: 13,
            updatedAt: '2026-07-31T12:00:00.000Z',
          },
          {
            followId: 'b',
            fromEpisode: 18,
            toEpisode: 20,
            updatedAt: '2026-07-31T12:00:00.000Z',
          },
        ],
      },
      checkedAt,
      [
        {
          followId: 'a',
          title: 'A',
          fromEpisode: 12,
          toEpisode: 14,
          hasUpdate: true,
        },
        {
          followId: 'b',
          title: 'B',
          fromEpisode: 18,
          toEpisode: 20,
          hasUpdate: true,
        },
      ],
    );

    expect(result.newUpdates).toEqual([
      { followId: 'a', title: 'A', fromEpisode: 12, toEpisode: 14 },
    ]);
    expect(result.updated).toEqual([
      { followId: 'b', title: 'B', fromEpisode: 18, toEpisode: 20 },
    ]);
  });

  it('reads legacy notification snapshot fields without changing display episodes', () => {
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
        snapshots: [
          {
            followId: 'one-piece',
            effectiveLatestEpisode: 13,
          } as never,
        ],
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
  });
});
