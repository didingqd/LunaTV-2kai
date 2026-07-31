import { UpdateDiffAnalyzer } from './update-diff-analyzer';

const checkedAt = new Date('2026-07-31T13:30:00.000Z').getTime();

describe('UpdateDiffAnalyzer', () => {
  const analyzer = new UpdateDiffAnalyzer();

  it('uses the first observation as a silent notification baseline', () => {
    const result = analyzer.analyze(
      [{ followId: 'one-piece', title: '海贼王', episode: 100 }],
      { snapshots: [], history: [] },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([]);
    expect(result.nextState).toEqual({
      snapshots: [{ followId: 'one-piece', episode: 100 }],
      history: [],
    });
  });

  it('records an effective episode increase without persisting the title', () => {
    const result = analyzer.analyze(
      [{ followId: 'one-piece', title: '海贼王', episode: 101 }],
      {
        snapshots: [{ followId: 'one-piece', episode: 100 }],
        history: [],
      },
      checkedAt,
    );

    expect(result.newUpdates).toEqual([
      {
        followId: 'one-piece',
        title: '海贼王',
        fromEpisode: 100,
        toEpisode: 101,
      },
    ]);
    expect(result.nextState.history).toEqual([
      {
        followId: 'one-piece',
        fromEpisode: 100,
        toEpisode: 101,
        updatedAt: '2026-07-31T13:30:00.000Z',
      },
    ]);
  });

  it('does not create an update for an unchanged episode and exposes history with the current title', () => {
    const result = analyzer.analyze(
      [{ followId: 'one-piece', title: '海贼王', episode: 101 }],
      {
        snapshots: [{ followId: 'one-piece', episode: 101 }],
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
    expect(result.updatedHistory).toEqual([
      {
        followId: 'one-piece',
        title: '海贼王',
        fromEpisode: 100,
        toEpisode: 101,
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
    ]);
  });

  it('records jump updates and does not lower the snapshot after a provider rollback', () => {
    const result = analyzer.analyze(
      [
        { followId: 'one-piece', title: '海贼王', episode: 105 },
        { followId: 'naruto', title: '火影忍者', episode: 103 },
      ],
      {
        snapshots: [
          { followId: 'one-piece', episode: 101 },
          { followId: 'naruto', episode: 105 },
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
      { followId: 'naruto', episode: 105 },
      { followId: 'one-piece', episode: 105 },
    ]);
  });
});
