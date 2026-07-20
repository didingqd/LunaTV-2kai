import {
  LEGACY_WATCHING_UPDATES_CACHE_KEY,
  readScopedWatchingUpdatesCache,
  resolveWatchingUpdatesCacheScope,
  watchingUpdatesQueryKey,
  writeScopedWatchingUpdatesCache,
} from './watching-updates-cache';
import type { WatchingUpdate } from './watching-update-result';

describe('WatchingUpdates scoped cache', () => {
  beforeEach(() => window.localStorage.clear());

  it('does not expose user A cache to user B', () => {
    const userA = onlineScope('user-a');
    const userB = onlineScope('user-b');
    writeScopedWatchingUpdatesCache(userA, createUpdate(100));

    expect(readScopedWatchingUpdatesCache(userA)?.data.timestamp).toBe(100);
    expect(readScopedWatchingUpdatesCache(userB)).toBeUndefined();
    expect(watchingUpdatesQueryKey(userA)).toEqual([
      'watchingUpdates',
      'online',
      'user-a',
    ]);
    expect(watchingUpdatesQueryKey(userB)).toEqual([
      'watchingUpdates',
      'online',
      'user-b',
    ]);
  });

  it('does not expose Online cache to Local mode', () => {
    const online = onlineScope('user-a');
    const local = resolveWatchingUpdatesCacheScope({ isLocal: true });
    expect(local).not.toBeNull();
    writeScopedWatchingUpdatesCache(online, createUpdate(200));

    expect(readScopedWatchingUpdatesCache(local!)).toBeUndefined();
    expect(watchingUpdatesQueryKey(local!)).toEqual([
      'watchingUpdates',
      'local',
      'local',
    ]);
  });

  it('does not trust an unscoped legacy cache as Online initial data', () => {
    const legacyValue = JSON.stringify(createUpdate(300));
    window.localStorage.setItem(LEGACY_WATCHING_UPDATES_CACHE_KEY, legacyValue);

    expect(
      readScopedWatchingUpdatesCache(onlineScope('user-a')),
    ).toBeUndefined();
    expect(window.localStorage.getItem(LEGACY_WATCHING_UPDATES_CACHE_KEY)).toBe(
      legacyValue,
    );
  });

  it('returns the persisted timestamp for initialDataUpdatedAt', () => {
    const scope = onlineScope('user-a');
    writeScopedWatchingUpdatesCache(scope, createUpdate(123456));

    expect(readScopedWatchingUpdatesCache(scope)?.timestamp).toBe(123456);
  });
});

function onlineScope(username: string) {
  const scope = resolveWatchingUpdatesCacheScope({
    isLocal: false,
    username,
  });
  if (!scope) throw new Error('Expected an Online cache scope');
  return scope;
}

function createUpdate(timestamp: number): WatchingUpdate {
  return {
    hasUpdates: false,
    timestamp,
    updatedCount: 0,
    continueWatchingCount: 0,
    newReleasesCount: 0,
    updatedSeries: [],
  };
}
