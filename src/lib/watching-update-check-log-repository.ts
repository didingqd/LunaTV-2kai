import { db } from './db';
import {
  type WatchingUpdateCheckLogEntry,
  type WatchingUpdateCheckLogQuery,
  type WatchingUpdateCheckLogSource,
} from './watching-update-check-log-types';

export const WATCHING_UPDATE_CHECK_LOG_CACHE_KEY =
  'watching-update-check-logs:v1';
export const WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY =
  'watching-update-check-logs:v2:global';
export const WATCHING_UPDATE_CHECK_LOG_USER_INDEX_CACHE_KEY =
  'watching-update-check-logs:v2:users';

export interface WatchingUpdateCheckLogStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown): Promise<void>;
  deleteCache(key: string): Promise<void>;
}

const writeQueues = new Map<string, Promise<void>>();

function storageIsAvailable(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !== 'localstorage'
  );
}

function isLogSource(value: unknown): value is WatchingUpdateCheckLogSource {
  // Stage 4H-H: include trigger so persisted trigger-link execution logs remain
  // readable through the existing repository validation and source filter path.
  return (
    value === 'cron' ||
    value === 'app' ||
    value === 'web' ||
    value === 'admin' ||
    value === 'trigger'
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

function asUsernames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (username): username is string =>
          typeof username === 'string' && username.length > 0,
      ),
    ),
  );
}

function userLogKey(username: string): string {
  return `watching-update-check-logs:v2:user:${encodeURIComponent(username)}`;
}

function filterLogs(
  logs: WatchingUpdateCheckLogEntry[],
  query: WatchingUpdateCheckLogQuery,
): WatchingUpdateCheckLogEntry[] {
  return logs
    .filter((entry) => !query.source || entry.source === query.source)
    .filter((entry) => !query.userId || entry.request.userId === query.userId);
}

function sortLogs(
  logs: WatchingUpdateCheckLogEntry[],
): WatchingUpdateCheckLogEntry[] {
  return [...logs].sort(
    (first, second) => second.execution.startedAt - first.execution.startedAt,
  );
}

function replaceLog(
  logs: WatchingUpdateCheckLogEntry[],
  entry: WatchingUpdateCheckLogEntry,
  retentionCount: number,
): WatchingUpdateCheckLogEntry[] {
  return [entry, ...logs.filter((existing) => existing.id !== entry.id)].slice(
    0,
    retentionCount,
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

  async append(
    entry: WatchingUpdateCheckLogEntry,
    retentionCount: number,
  ): Promise<void> {
    return this.appendGlobal(entry, retentionCount);
  }

  async appendGlobal(
    entry: WatchingUpdateCheckLogEntry,
    retentionCount: number,
  ): Promise<void> {
    if (!storageIsAvailable()) return;
    await queuedWrite(WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY, async () => {
      const existing = asLogs(
        await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY),
      );
      await this.store.setCache(
        WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY,
        [entry, ...existing].slice(0, retentionCount),
      );
    });
  }

  async replaceGlobal(
    entry: WatchingUpdateCheckLogEntry,
    retentionCount: number,
  ): Promise<void> {
    if (!storageIsAvailable()) return;
    await queuedWrite(WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY, async () => {
      const existing = asLogs(
        await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY),
      );
      await this.store.setCache(
        WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY,
        replaceLog(existing, entry, retentionCount),
      );
    });
  }

  async removeGlobal(id: string): Promise<void> {
    if (!storageIsAvailable()) return;
    await queuedWrite(WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY, async () => {
      const existing = asLogs(
        await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY),
      );
      await this.store.setCache(
        WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY,
        existing.filter((entry) => entry.id !== id),
      );
    });
  }

  async appendForUser(
    username: string,
    entry: WatchingUpdateCheckLogEntry,
    retentionCount: number,
  ): Promise<void> {
    if (!storageIsAvailable()) return;
    await this.ensureUserIndexed(username);
    const key = userLogKey(username);
    await queuedWrite(key, async () => {
      const existing = asLogs(await this.store.getCache(key));
      await this.store.setCache(
        key,
        [entry, ...existing].slice(0, retentionCount),
      );
    });
  }

  async replaceForUser(
    username: string,
    entry: WatchingUpdateCheckLogEntry,
    retentionCount: number,
  ): Promise<void> {
    if (!storageIsAvailable()) return;
    await this.ensureUserIndexed(username);
    const key = userLogKey(username);
    await queuedWrite(key, async () => {
      const existing = asLogs(await this.store.getCache(key));
      await this.store.setCache(
        key,
        replaceLog(existing, entry, retentionCount),
      );
    });
  }

  async list(
    retentionCount: number,
    query: WatchingUpdateCheckLogQuery = {},
  ): Promise<WatchingUpdateCheckLogEntry[]> {
    if (!storageIsAvailable()) return [];
    const limit = Math.max(
      1,
      Math.min(query.limit ?? retentionCount, retentionCount),
    );
    if (query.userId) {
      return this.listForUser(query.userId, retentionCount, query);
    }

    const usernames = await this.listIndexedUsers();
    const userLogs = await Promise.all(
      usernames.map((username) => this.readUserLogs(username)),
    );
    const globalLogs = asLogs(
      await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_GLOBAL_CACHE_KEY),
    );
    const legacyLogs = asLogs(
      await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_CACHE_KEY),
    );
    return sortLogs(
      filterLogs([...globalLogs, ...userLogs.flat(), ...legacyLogs], query),
    ).slice(0, limit);
  }

  async listForUser(
    username: string,
    retentionCount: number,
    query: Omit<WatchingUpdateCheckLogQuery, 'userId'> = {},
  ): Promise<WatchingUpdateCheckLogEntry[]> {
    if (!storageIsAvailable()) return [];
    const limit = Math.max(
      1,
      Math.min(query.limit ?? retentionCount, retentionCount),
    );
    const userLogs = await this.readUserLogs(username);
    const legacyLogs = filterLogs(
      asLogs(await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_CACHE_KEY)),
      { ...query, userId: username },
    );
    return sortLogs(filterLogs([...userLogs, ...legacyLogs], query)).slice(
      0,
      limit,
    );
  }

  async clearForUser(username: string): Promise<void> {
    if (!storageIsAvailable()) return;
    const key = userLogKey(username);
    await queuedWrite(key, async () => {
      await this.store.deleteCache(key);
    });
    await queuedWrite(
      WATCHING_UPDATE_CHECK_LOG_USER_INDEX_CACHE_KEY,
      async () => {
        const usernames = asUsernames(
          await this.store.getCache(
            WATCHING_UPDATE_CHECK_LOG_USER_INDEX_CACHE_KEY,
          ),
        ).filter((candidate) => candidate !== username);
        await this.store.setCache(
          WATCHING_UPDATE_CHECK_LOG_USER_INDEX_CACHE_KEY,
          usernames,
        );
      },
    );
  }

  private async ensureUserIndexed(username: string): Promise<void> {
    await queuedWrite(
      WATCHING_UPDATE_CHECK_LOG_USER_INDEX_CACHE_KEY,
      async () => {
        const usernames = asUsernames(
          await this.store.getCache(
            WATCHING_UPDATE_CHECK_LOG_USER_INDEX_CACHE_KEY,
          ),
        );
        if (usernames.includes(username)) return;
        await this.store.setCache(
          WATCHING_UPDATE_CHECK_LOG_USER_INDEX_CACHE_KEY,
          [...usernames, username],
        );
      },
    );
  }

  private async listIndexedUsers(): Promise<string[]> {
    return asUsernames(
      await this.store.getCache(WATCHING_UPDATE_CHECK_LOG_USER_INDEX_CACHE_KEY),
    );
  }

  private async readUserLogs(
    username: string,
  ): Promise<WatchingUpdateCheckLogEntry[]> {
    return asLogs(await this.store.getCache(userLogKey(username)));
  }
}

export const watchingUpdateCheckLogRepository =
  new WatchingUpdateCheckLogRepository();
