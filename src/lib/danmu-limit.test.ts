import {
  applyDanmuSegmentLimit,
  danmuSegmentLimitStorageKey,
  DEFAULT_DANMU_SEGMENT_LIMIT,
  loadDanmuSegmentLimit,
  resolveDanmuSegmentLimitScope,
  saveDanmuSegmentLimit,
  sanitizeDanmuSegmentLimit,
} from './danmu-limit';

describe('Danmu segment limit', () => {
  beforeEach(() => window.localStorage.clear());

  it('limits each 300-second segment independently', () => {
    const danmu = [
      item('s0-a', 0),
      item('s0-b', 10),
      item('s0-c', 299.9),
      item('s1-a', 300),
      item('s1-b', 450),
      item('s1-c', 599.9),
    ];

    expect(applyDanmuSegmentLimit(danmu, 2).map((entry) => entry.id)).toEqual([
      's0-a',
      's0-b',
      's1-a',
      's1-b',
    ]);
  });

  it('does not treat the limit as a whole-episode cap', () => {
    const danmu = [
      item('s0-a', 0),
      item('s0-b', 1),
      item('s1-a', 300),
      item('s1-b', 301),
      item('s2-a', 600),
      item('s2-b', 601),
    ];

    expect(applyDanmuSegmentLimit(danmu, 2)).toHaveLength(6);
  });

  it('keeps at most 500 items in each segment', () => {
    const firstSegment = Array.from({ length: 550 }, (_, index) =>
      item(`s0-${index}`, index % 300),
    );
    const secondSegment = Array.from({ length: 520 }, (_, index) =>
      item(`s1-${index}`, 300 + (index % 300)),
    );

    const limited = applyDanmuSegmentLimit(
      [...firstSegment, ...secondSegment],
      500,
    );

    expect(limited).toHaveLength(1000);
    expect(limited.filter((entry) => entry.time < 300)).toHaveLength(500);
    expect(limited.filter((entry) => entry.time >= 300)).toHaveLength(500);
  });

  it('allows 10000 items in a segment before trimming', () => {
    const danmu = Array.from({ length: 10001 }, (_, index) =>
      item(`s0-${index}`, index % 300),
    );

    expect(applyDanmuSegmentLimit(danmu, 10000)).toHaveLength(10000);
  });

  it('keeps all items when limit is 0', () => {
    const danmu = [item('a', 0), item('b', 1), item('c', 2), item('d', 3)];

    expect(applyDanmuSegmentLimit(danmu, 0)).toEqual(danmu);
  });

  it('sanitizes invalid values without replacing explicit 0', () => {
    expect(sanitizeDanmuSegmentLimit(0, 5000)).toBe(0);
    expect(sanitizeDanmuSegmentLimit('10000')).toBe(10000);
    expect(sanitizeDanmuSegmentLimit(500.8)).toBe(500);
    expect(sanitizeDanmuSegmentLimit(-1, 3000)).toBe(3000);
    expect(sanitizeDanmuSegmentLimit('', 3000)).toBe(3000);
  });

  it('stores limits under user-scoped keys', () => {
    const userA = resolveDanmuSegmentLimitScope('alice');
    const userB = resolveDanmuSegmentLimitScope('bob');

    saveDanmuSegmentLimit(500, 'alice');
    saveDanmuSegmentLimit(0, 'bob');

    expect(loadDanmuSegmentLimit('alice')).toBe(500);
    expect(loadDanmuSegmentLimit('bob')).toBe(0);
    expect(loadDanmuSegmentLimit('charlie')).toBe(DEFAULT_DANMU_SEGMENT_LIMIT);
    expect(danmuSegmentLimitStorageKey(userA)).not.toBe(
      danmuSegmentLimitStorageKey(userB),
    );
  });
});

function item(id: string, time: number) {
  return { id, time, text: id };
}
