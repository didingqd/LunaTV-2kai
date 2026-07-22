import {
  normalizeWatchingUpdate,
  type WatchingUpdate,
} from './watching-update-result';
import type { WatchingUpdateSourceMode } from './watching-update-preference';

export const LEGACY_WATCHING_UPDATES_CACHE_KEY =
  'moontv_watching_updates_follow_v1';
export const WATCHING_UPDATES_CACHE_PREFIX =
  'moontv_watching_updates_follow_v2';
export const WATCHING_UPDATES_STALE_TIME = 30 * 60 * 1000;
export const WATCHING_UPDATES_QUERY_ROOT = ['watchingUpdates'] as const;

export type WatchingUpdatesCacheMode = 'online' | 'local';
export type WatchingUpdatesFreshness = 'fresh' | 'stale' | 'error';

export interface WatchingUpdatesCacheScope {
  mode: WatchingUpdatesCacheMode;
  principal: string;
  sourceMode: WatchingUpdateSourceMode;
}

export interface ScopedWatchingUpdatesCache {
  data: WatchingUpdate;
  timestamp: number;
  freshness: WatchingUpdatesFreshness;
}

interface WatchingUpdatesCacheEnvelope {
  version: 2;
  mode: WatchingUpdatesCacheMode;
  principal: string;
  sourceMode?: WatchingUpdateSourceMode;
  timestamp: number;
  freshness?: WatchingUpdatesFreshness;
  data: unknown;
}

export function resolveWatchingUpdatesCacheScope({
  isLocal,
  username,
  sourceMode = 'local',
}: {
  isLocal: boolean;
  username?: string | null;
  sourceMode?: WatchingUpdateSourceMode;
}): WatchingUpdatesCacheScope | null {
  if (isLocal) return { mode: 'local', principal: 'local', sourceMode };

  const principal = username?.trim();
  return principal ? { mode: 'online', principal, sourceMode } : null;
}

export function watchingUpdatesQueryKey(scope: WatchingUpdatesCacheScope) {
  return [
    ...WATCHING_UPDATES_QUERY_ROOT,
    scope.sourceMode,
    scope.mode,
    scope.principal,
  ] as const;
}

export function watchingUpdatesStorageKey(
  scope: WatchingUpdatesCacheScope,
): string {
  const sourcePrefix = scope.sourceMode === 'backend' ? ':backend' : '';
  return `${WATCHING_UPDATES_CACHE_PREFIX}${sourcePrefix}:${scope.mode}:${encodeURIComponent(scope.principal)}`;
}

export function readScopedWatchingUpdatesCache(
  scope: WatchingUpdatesCacheScope,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): ScopedWatchingUpdatesCache | undefined {
  const raw = storage.getItem(watchingUpdatesStorageKey(scope));
  if (!raw) return undefined;

  try {
    const envelope = JSON.parse(raw) as Partial<WatchingUpdatesCacheEnvelope>;
    const storedSourceMode = envelope.sourceMode ?? 'local';
    if (
      envelope.version !== 2 ||
      envelope.mode !== scope.mode ||
      envelope.principal !== scope.principal ||
      storedSourceMode !== scope.sourceMode ||
      typeof envelope.timestamp !== 'number' ||
      !Number.isFinite(envelope.timestamp) ||
      envelope.timestamp <= 0
    ) {
      return undefined;
    }

    const data = normalizeWatchingUpdate(envelope.data);
    if (!data) return undefined;
    const storedFreshness = envelope.freshness;
    const freshness: WatchingUpdatesFreshness =
      storedFreshness === 'error' || storedFreshness === 'stale'
        ? storedFreshness
        : Date.now() - envelope.timestamp > WATCHING_UPDATES_STALE_TIME
          ? 'stale'
          : 'fresh';
    return { data, timestamp: envelope.timestamp, freshness };
  } catch {
    return undefined;
  }
}

export function writeScopedWatchingUpdatesCache(
  scope: WatchingUpdatesCacheScope,
  data: WatchingUpdate,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
  freshness: WatchingUpdatesFreshness = 'fresh',
): void {
  const timestamp =
    Number.isFinite(data.timestamp) && data.timestamp > 0
      ? data.timestamp
      : Date.now();
  const envelope: WatchingUpdatesCacheEnvelope = {
    version: 2,
    mode: scope.mode,
    principal: scope.principal,
    sourceMode: scope.sourceMode,
    timestamp,
    freshness,
    data,
  };
  storage.setItem(watchingUpdatesStorageKey(scope), JSON.stringify(envelope));
}

export function sameWatchingUpdatesCacheScope(
  left: WatchingUpdatesCacheScope,
  right: WatchingUpdatesCacheScope,
): boolean {
  return (
    left.mode === right.mode &&
    left.principal === right.principal &&
    left.sourceMode === right.sourceMode
  );
}
