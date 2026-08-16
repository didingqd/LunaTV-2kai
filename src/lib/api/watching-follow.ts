import type { WatchingFollow } from '@/lib/types';
import {
  migrateStoredWatchingFollow,
  watchingFollowStorageKey,
} from '@/lib/watching-follow';

export const LOCAL_WATCHING_FOLLOWS_KEY = 'watching_follows_local_v1';

export type CreateWatchingFollowInput = Pick<
  WatchingFollow,
  'source' | 'id' | 'title' | 'cover' | 'year' | 'type' | 'originalEpisodes'
> &
  Partial<Pick<WatchingFollow, 'enabled'>>;

export type UpdateWatchingFollowInput = Partial<
  Pick<WatchingFollow, 'title' | 'cover' | 'year' | 'type' | 'enabled'>
>;

export class WatchingFollowApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'WatchingFollowApiError';
  }
}

export function watchingFollowKey(source: string, id: string): string {
  return watchingFollowStorageKey(source, id);
}

export function isLocalWatchingFollowMode(): boolean {
  if (typeof window !== 'undefined') {
    const runtimeWindow = window as Window & {
      RUNTIME_CONFIG?: { STORAGE_TYPE?: string };
    };
    return (
      (runtimeWindow.RUNTIME_CONFIG?.STORAGE_TYPE ||
        process.env.NEXT_PUBLIC_STORAGE_TYPE ||
        'localstorage') === 'localstorage'
    );
  }

  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  );
}

export function parseWatchingFollow(value: unknown): WatchingFollow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WatchingFollowApiError('Invalid WatchingFollow response');
  }

  const follow = value as Record<string, unknown>;
  if (
    typeof follow.source !== 'string' ||
    follow.source.length === 0 ||
    typeof follow.id !== 'string' ||
    follow.id.length === 0 ||
    typeof follow.title !== 'string' ||
    typeof follow.cover !== 'string' ||
    typeof follow.year !== 'string' ||
    typeof follow.type !== 'string' ||
    typeof follow.originalEpisodes !== 'number' ||
    !Number.isInteger(follow.originalEpisodes) ||
    follow.originalEpisodes < 0 ||
    typeof follow.createdAt !== 'number' ||
    !Number.isFinite(follow.createdAt) ||
    typeof follow.updatedAt !== 'number' ||
    !Number.isFinite(follow.updatedAt) ||
    typeof follow.enabled !== 'boolean'
  ) {
    throw new WatchingFollowApiError('Invalid WatchingFollow response');
  }

  return {
    source: follow.source,
    id: follow.id,
    title: follow.title,
    cover: follow.cover,
    year: follow.year,
    type: follow.type,
    originalEpisodes: follow.originalEpisodes,
    createdAt: follow.createdAt,
    updatedAt: follow.updatedAt,
    enabled: follow.enabled,
  };
}

export function parseWatchingFollowRecord(
  value: unknown,
): Record<string, WatchingFollow> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WatchingFollowApiError('Invalid WatchingFollow list response');
  }

  const result: Record<string, WatchingFollow> = {};
  for (const [key, rawFollow] of Object.entries(value)) {
    const follow = parseWatchingFollow(rawFollow);
    if (key !== watchingFollowKey(follow.source, follow.id)) {
      throw new WatchingFollowApiError(
        'WatchingFollow response key does not match source and id',
      );
    }
    result[key] = follow;
  }
  return result;
}

export function isWatchingFollowActive(
  follows: Record<string, WatchingFollow>,
  source: string,
  id: string,
): boolean {
  return follows[watchingFollowKey(source, id)]?.enabled === true;
}

function readLocalWatchingFollows(): Record<string, WatchingFollow> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(LOCAL_WATCHING_FOLLOWS_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new WatchingFollowApiError('Invalid local WatchingFollow data');
    }
    const migrated: Record<string, WatchingFollow> = {};
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      const follow = migrateStoredWatchingFollow(value);
      if (!follow) continue;
      migrated[watchingFollowKey(follow.source, follow.id)] = follow;
    }
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
      writeLocalWatchingFollows(migrated);
    }
    return migrated;
  } catch (error) {
    throw new WatchingFollowApiError(
      error instanceof Error
        ? error.message
        : 'Invalid local WatchingFollow data',
    );
  }
}

function writeLocalWatchingFollows(
  follows: Record<string, WatchingFollow>,
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    LOCAL_WATCHING_FOLLOWS_KEY,
    JSON.stringify(follows),
  );
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `WatchingFollow request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = String(body.error);
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new WatchingFollowApiError(message, response.status);
  }
  return response.json();
}

export async function getWatchingFollows(): Promise<
  Record<string, WatchingFollow>
> {
  if (isLocalWatchingFollowMode()) {
    return readLocalWatchingFollows();
  }

  const response = await requestJson('/api/watching-follows');
  return parseWatchingFollowRecord(response);
}

export async function postWatchingFollow(
  input: CreateWatchingFollowInput,
): Promise<WatchingFollow> {
  const now = Date.now();
  const follow: WatchingFollow = {
    source: input.source,
    id: input.id,
    title: input.title,
    cover: input.cover,
    year: input.year,
    type: input.type,
    originalEpisodes: input.originalEpisodes,
    createdAt: now,
    updatedAt: now,
    enabled: input.enabled ?? true,
  };

  if (isLocalWatchingFollowMode()) {
    const follows = readLocalWatchingFollows();
    const key = watchingFollowKey(follow.source, follow.id);
    if (follows[key]) {
      throw new WatchingFollowApiError('WatchingFollow already exists', 409);
    }
    follows[key] = follow;
    writeLocalWatchingFollows(follows);
    return follow;
  }

  const response = await requestJson('/api/watching-follows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: follow.source,
      id: follow.id,
      title: follow.title,
      cover: follow.cover,
      year: follow.year,
      type: follow.type,
      originalEpisodes: follow.originalEpisodes,
      enabled: follow.enabled,
    }),
  });
  return parseWatchingFollow(response);
}

export async function putWatchingFollow(
  source: string,
  id: string,
  input: UpdateWatchingFollowInput,
): Promise<WatchingFollow> {
  if (isLocalWatchingFollowMode()) {
    const follows = readLocalWatchingFollows();
    const key = watchingFollowKey(source, id);
    const existing = follows[key];
    if (!existing) {
      throw new WatchingFollowApiError('WatchingFollow not found', 404);
    }
    const follow: WatchingFollow = {
      ...existing,
      ...input,
      originalEpisodes: existing.originalEpisodes,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    follows[key] = follow;
    writeLocalWatchingFollows(follows);
    return follow;
  }

  const path = `/api/watching-follows/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
  const response = await requestJson(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseWatchingFollow(response);
}

export async function advanceWatchingFollowOriginalEpisodes(
  source: string,
  id: string,
  confirmedEpisode: number,
): Promise<WatchingFollow> {
  const normalizedEpisode =
    Number.isFinite(confirmedEpisode) && confirmedEpisode > 0
      ? Math.floor(confirmedEpisode)
      : 0;

  if (isLocalWatchingFollowMode()) {
    const follows = readLocalWatchingFollows();
    const key = watchingFollowKey(source, id);
    const existing = follows[key];
    if (!existing) {
      throw new WatchingFollowApiError('WatchingFollow not found', 404);
    }
    const nextEpisodes = Math.max(existing.originalEpisodes, normalizedEpisode);
    // This is the Web local-mode equivalent of the backend baseline endpoint.
    // It updates only the confirmation baseline and never touches PlayRecord
    // state, so Continue Watching remains the user's actual playback position.
    const follow: WatchingFollow =
      nextEpisodes === existing.originalEpisodes
        ? existing
        : {
            ...existing,
            originalEpisodes: nextEpisodes,
            updatedAt: Date.now(),
          };
    follows[key] = follow;
    writeLocalWatchingFollows(follows);
    return follow;
  }

  const path = `/api/watching-follows/${encodeURIComponent(source)}/${encodeURIComponent(id)}/original-episodes`;
  const response = await requestJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      originalEpisodes: normalizedEpisode,
    }),
  });
  return parseWatchingFollow(response);
}

export async function deleteWatchingFollow(
  source: string,
  id: string,
): Promise<void> {
  if (isLocalWatchingFollowMode()) {
    const follows = readLocalWatchingFollows();
    delete follows[watchingFollowKey(source, id)];
    writeLocalWatchingFollows(follows);
    return;
  }

  const path = `/api/watching-follows/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
  await requestJson(path, { method: 'DELETE' });
}
