import {
  getWatchingFollowBaselineMenuState,
  type WatchingFollowBaselineMenuState,
} from '@/hooks/useWatchingFollows';
import type { WatchingFollow } from '@/lib/types';

describe('getWatchingFollowBaselineMenuState', () => {
  const follow: WatchingFollow = {
    source: 'main',
    id: 'demo',
    title: 'Demo',
    cover: '',
    year: '2026',
    type: 'tv',
    originalEpisodes: 11,
    createdAt: 1,
    updatedAt: 1,
    enabled: true,
  };

  it('returns null when no active follow exists', () => {
    const state = getWatchingFollowBaselineMenuState({}, 'main', 'demo', 18);

    expect(state).toBeNull();
  });

  it('returns mark-to-latest when the baseline is behind latest', () => {
    const state = getWatchingFollowBaselineMenuState(
      { demo: follow },
      'main',
      'demo',
      18,
    );

    expect(state).toEqual<WatchingFollowBaselineMenuState>({
      title: '标记为看至最新',
      isAlreadyAtLatest: false,
    });
  });

  it('returns watched-to-latest when the baseline already matches latest', () => {
    const state = getWatchingFollowBaselineMenuState(
      { demo: { ...follow, originalEpisodes: 18 } },
      'main',
      'demo',
      18,
    );

    expect(state).toEqual<WatchingFollowBaselineMenuState>({
      title: '已观看至最新',
      isAlreadyAtLatest: true,
    });
  });
});
