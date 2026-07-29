import { db } from './db';
import {
  WATCHING_UPDATE_CHECK_LOG_LIMIT,
  type WatchingUpdateCheckLogEntry,
  type WatchingUpdateCheckLogQuery,
  type WatchingUpdateCheckLogSource,
} from './watching-update-check-log-types';

export const WATCHING_UPDATE_CHECK_LOG_CACHE_KEY =
  'watching-update-check-logs:v1';

export interface WatchingUpdateCheckLogStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown): Promise<void>;
}

const writeQueues = new Map<string, Promise<void>>();

function storageIsAvailable(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !== 'localstorage'
  );
}

function isLogSource(value: unknown): value is WatchingUpdateCheckLogSource {
  return (
    value === 'cron' || value === 'app' || value === 'web' || value === 'admin'
  );
}

function asLogs(value: unknown): WatchingUpdateCheckLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is WatchingUpdateCheckLogEntry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as WatchingUpdateCheckLogEntry).id === 'string' &&
      isLogSource((entry as WatchingUpdateCheckLogEntry).source),
  );
}

async function queuedWrite<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  writeQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  }
}

export class WatchingUpdateCheckLogRepository {
  constructor(private readonly store: WatchingUpdateCheckLogStore = db) {}

  async append(entry: WatchingUpdateCheckLogEntry): Promise<void> {
    if (!storageIsAvailable()) return;
    await queuedWrite(WATCHING_UPDATE_CHECK_LOG_CACHE_KEY, async () => {
      const existing = asLogs(
        await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_CACHE_KEY),
      );
      await this.store.setCache(
        WATCHING_UPDATE_CHECK_LOG_CACHE_KEY,
        [entry, ...existing].slice(0, WATCHING_UPDATE_CHECK_LOG_LIMIT),
      );
    });
  }

  async list(
    query: WatchingUpdateCheckLogQuery = {},
  ): Promise<WatchingUpdateCheckLogEntry[]> {
    if (!storageIsAvailable()) return [];
    const limit = Math.max(
      1,
      Math.min(
        query.limit ?? WATCHING_UPDATE_CHECK_LOG_LIMIT,
        WATCHING_UPDATE_CHECK_LOG_LIMIT,
      ),
    );
    return asLogs(
      await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_CACHE_KEY),
    )
      .filter((entry) => !query.source || entry.source === query.source)
      .filter((entry) => !query.userId || entry.request.userId === query.userId)
      .slice(0, limit);
  }
}

export const watchingUpdateCheckLogRepository =
  new WatchingUpdateCheckLogRepository();
