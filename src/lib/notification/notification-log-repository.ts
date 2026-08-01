import { db } from '@/lib/db';

import {
  DEFAULT_NOTIFICATION_LOG_LIMIT,
  type NotificationProviderHealthStatus,
  type NotificationSendLogEntry,
  type NotificationSendLogQuery,
  type NotificationSendStatus,
  normalizeNotificationLogLimit,
} from './notification-log-types';

export const NOTIFICATION_SEND_LOG_CACHE_KEY = 'notification-send-logs:v1';

export interface NotificationSendLogStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown): Promise<void>;
}

const writeQueues = new Map<string, Promise<void>>();

function storageIsAvailable(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !== 'localstorage'
  );
}

function isStatus(value: unknown): value is NotificationSendStatus {
  return value === 'success' || value === 'failed' || value === 'skipped';
}

function asLogs(value: unknown): NotificationSendLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is NotificationSendLogEntry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as NotificationSendLogEntry).eventType === 'string' &&
      typeof (entry as NotificationSendLogEntry).channelId === 'string' &&
      typeof (entry as NotificationSendLogEntry).providerType === 'string' &&
      isStatus((entry as NotificationSendLogEntry).status) &&
      typeof (entry as NotificationSendLogEntry).createdAt === 'number',
  );
}

function sortLogs(
  logs: NotificationSendLogEntry[],
): NotificationSendLogEntry[] {
  return [...logs].sort((left, right) => right.createdAt - left.createdAt);
}

function filterLogs(
  logs: NotificationSendLogEntry[],
  query: NotificationSendLogQuery,
): NotificationSendLogEntry[] {
  return logs
    .filter(
      (log) => !query.providerType || log.providerType === query.providerType,
    )
    .filter((log) => !query.channelId || log.channelId === query.channelId)
    .filter((log) => !query.status || log.status === query.status);
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

export class NotificationSendLogRepository {
  constructor(private readonly store: NotificationSendLogStore = db) {}

  async append(
    entry: NotificationSendLogEntry,
    retentionCount = DEFAULT_NOTIFICATION_LOG_LIMIT,
  ): Promise<void> {
    if (!storageIsAvailable()) return;
    const limit = normalizeNotificationLogLimit(retentionCount);
    await queuedWrite(NOTIFICATION_SEND_LOG_CACHE_KEY, async () => {
      const existing = asLogs(
        await this.store.getCache(NOTIFICATION_SEND_LOG_CACHE_KEY),
      );
      await this.store.setCache(
        NOTIFICATION_SEND_LOG_CACHE_KEY,
        [entry, ...existing].slice(0, limit),
      );
    });
  }

  async list(
    query: NotificationSendLogQuery = {},
  ): Promise<NotificationSendLogEntry[]> {
    if (!storageIsAvailable()) return [];
    const limit = normalizeNotificationLogLimit(
      query.limit ?? DEFAULT_NOTIFICATION_LOG_LIMIT,
    );
    const logs = asLogs(
      await this.store.getCache(NOTIFICATION_SEND_LOG_CACHE_KEY),
    );
    return sortLogs(filterLogs(logs, query)).slice(0, limit);
  }

  async getProviderHealth(): Promise<
    Record<string, NotificationProviderHealthStatus>
  > {
    const logs = await this.list({ limit: DEFAULT_NOTIFICATION_LOG_LIMIT });
    const latestByProvider = new Map<string, NotificationSendLogEntry>();
    for (const log of logs) {
      if (!latestByProvider.has(log.providerType)) {
        latestByProvider.set(log.providerType, log);
      }
    }

    return Object.fromEntries(
      Array.from(latestByProvider.entries()).map(([providerType, log]) => [
        providerType,
        log.status === 'failed'
          ? 'failed'
          : log.status === 'skipped'
            ? 'warning'
            : 'healthy',
      ]),
    );
  }
}

export const notificationSendLogRepository =
  new NotificationSendLogRepository();
