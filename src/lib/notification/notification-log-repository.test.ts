/** @jest-environment node */

import {
  NOTIFICATION_SEND_LOG_CACHE_KEY,
  NotificationSendLogRepository,
} from './notification-log-repository';
import type { NotificationSendLogEntry } from './notification-log-types';

class MemoryStore {
  data = new Map<string, unknown>();

  async getCache(key: string): Promise<unknown | null> {
    return this.data.get(key) ?? null;
  }

  async setCache(key: string, data: unknown): Promise<void> {
    this.data.set(key, data);
  }
}

function log(
  overrides: Partial<NotificationSendLogEntry> = {},
): NotificationSendLogEntry {
  return {
    eventType: 'watching.update_found',
    channelId: 'channel-1',
    providerType: 'webhook',
    status: 'success',
    createdAt: 1_000,
    ...overrides,
  };
}

describe('NotificationSendLogRepository', () => {
  const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
  });

  afterEach(() => {
    if (originalStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    }
  });

  it('records and lists successful sends newest first', async () => {
    const store = new MemoryStore();
    const repository = new NotificationSendLogRepository(store);

    await repository.append(log({ channelId: 'old', createdAt: 1_000 }));
    await repository.append(log({ channelId: 'new', createdAt: 2_000 }));

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ channelId: 'new', status: 'success' }),
      expect.objectContaining({ channelId: 'old', status: 'success' }),
    ]);
  });

  it('records failed sends with error reasons', async () => {
    const store = new MemoryStore();
    const repository = new NotificationSendLogRepository(store);

    await repository.append(
      log({ status: 'failed', error: 'provider failed' }),
    );

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
        error: 'provider failed',
      }),
    ]);
  });

  it('records preview skips and keeps retention bounded', async () => {
    const store = new MemoryStore();
    const repository = new NotificationSendLogRepository(store);

    await repository.append(log({ channelId: 'first' }), 2);
    await repository.append(
      log({ channelId: 'preview', status: 'skipped' }),
      2,
    );
    await repository.append(log({ channelId: 'latest', createdAt: 3_000 }), 2);

    await expect(repository.list({ limit: 10 })).resolves.toEqual([
      expect.objectContaining({ channelId: 'latest' }),
      expect.objectContaining({ channelId: 'preview', status: 'skipped' }),
    ]);
    expect(await store.getCache(NOTIFICATION_SEND_LOG_CACHE_KEY)).toHaveLength(
      2,
    );
  });

  it('derives provider health from recent send results', async () => {
    const store = new MemoryStore();
    const repository = new NotificationSendLogRepository(store);

    await repository.append(
      log({ providerType: 'webhook', status: 'success' }),
    );
    await repository.append(
      log({ providerType: 'telegram', status: 'failed', createdAt: 2_000 }),
    );
    await repository.append(
      log({ providerType: 'resend', status: 'skipped', createdAt: 3_000 }),
    );

    await expect(repository.getProviderHealth()).resolves.toEqual({
      webhook: 'healthy',
      telegram: 'failed',
      resend: 'warning',
    });
  });
});
