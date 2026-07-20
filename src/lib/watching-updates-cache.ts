import {
  normalizeWatchingUpdate,
  type WatchingUpdate,
} from './watching-update-result';

export const LEGACY_WATCHING_UPDATES_CACHE_KEY =
  'moontv_watching_updates_follow_v1';
export const WATCHING_UPDATES_CACHE_PREFIX =
  'moontv_watching_updates_follow_v2';
export const WATCHING_UPDATES_STALE_TIME = 30 * 60 * 1000;
export const WATCHING_UPDATES_QUERY_ROOT = ['watchingUpdates'] as const;

export type WatchingUpdatesCacheMode = 'online' | 'local';

export interface WatchingUpdatesCacheScope {
  mode: WatchingUpdatesCacheMode;
  principal: string;
}

export interface ScopedWatchingUpdatesCache {
  data: WatchingUpdate;
  timestamp: number;
}

interface WatchingUpdatesCacheEnvelope {
  version: 2;
  mode: WatchingUpdatesCacheMode;
  principal: string;
  timestamp: number;
  data: unknown;
}

export function resolveWatchingUpdatesCacheScope({
  isLocal,
  username,
}: {
  isLocal: boolean;
  username?: string | null;
}): WatchingUpdatesCacheScope | null {
  if (isLocal) return { mode: 'local', principal: 'local' };

  const principal = username?.trim();
  return principal ? { mode: 'online', principal } : null;
}

export function watchingUpdatesQueryKey(scope: WatchingUpdatesCacheScope) {
  return [...WATCHING_UPDATES_QUERY_ROOT, scope.mode, scope.principal] as const;
}

export function watchingUpdatesStorageKey(
  scope: WatchingUpdatesCacheScope,
): string {
  return `${WATCHING_UPDATES_CACHE_PREFIX}:${scope.mode}:${encodeURIComponent(scope.principal)}`;
}

export function readScopedWatchingUpdatesCache(
  scope: WatchingUpdatesCacheScope,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): ScopedWatchingUpdatesCache | undefined {
  const raw = storage.getItem(watchingUpdatesStorageKey(scope));
  if (!raw) return undefined;

  try {
    const envelope = JSON.parse(raw) as Partial<WatchingUpdatesCacheEnvelope>;
    if (
      envelope.version !== 2 ||
      envelope.mode !== scope.mode ||
      envelope.principal !== scope.principal ||
      typeof envelope.timestamp !== 'number' ||
      !Number.isFinite(envelope.timestamp) ||
      envelope.timestamp <= 0
    ) {
      return undefined;
    }

    const data = normalizeWatchingUpdate(envelope.data);
    return data ? { data, timestamp: envelope.timestamp } : undefined;
  } catch {
    return undefined;
  }
}

export function writeScopedWatchingUpdatesCache(
  scope: WatchingUpdatesCacheScope,
  data: WatchingUpdate,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  const timestamp =
    Number.isFinite(data.timestamp) && data.timestamp > 0
      ? data.timestamp
      : Date.now();
  const envelope: WatchingUpdatesCacheEnvelope = {
    version: 2,
    mode: scope.mode,
    principal: scope.principal,
    timestamp,
    data,
  };
  storage.setItem(watchingUpdatesStorageKey(scope), JSON.stringify(envelope));
}

export function sameWatchingUpdatesCacheScope(
  left: WatchingUpdatesCacheScope,
  right: WatchingUpdatesCacheScope,
): boolean {
  return left.mode === right.mode && left.principal === right.principal;
}
