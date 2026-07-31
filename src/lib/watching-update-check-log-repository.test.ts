/** @jest-environment node */

import {
  WATCHING_UPDATE_CHECK_LOG_CACHE_KEY,
  WatchingUpdateCheckLogRepository,
} from './watching-update-check-log-repository';
import type { WatchingUpdateCheckLogEntry } from './watching-update-check-log-types';

class MemoryLogStore {
  values = new Map<string, unknown>();

  async getCache(key: string): Promise<unknown | null> {
    return this.values.get(key) ?? null;
  }

  async setCache(key: string, data: unknown): Promise<void> {
    this.values.set(key, data);
  }

  async deleteCache(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function log(
  id: string,
  userId: string,
  startedAt: number,
): WatchingUpdateCheckLogEntry {
  return {
    id,
    source: 'cron',
    operation: 'scheduled-check',
    request: {
      method: 'GET',
      path: '/api/cron/update-checks',
      userId,
      client: {},
    },
    execution: {
      startedAt,
      endedAt: startedAt + 1,
      durationMs: 1,
      success: true,
    },
    result: {
      checkedCount: 1,
      successCount: 1,
      failureCount: 0,
      updateFoundCount: 0,
      updates: [],
    },
  };
}

const previousStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

describe('WatchingUpdateCheckLogRepository', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
  });

  afterAll(() => {
    if (previousStorageType === undefined)
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = previousStorageType;
  });

  it('isolates logs by user partition', async () => {
    const store = new MemoryLogStore();
    const repository = new WatchingUpdateCheckLogRepository(store);

    await repository.appendForUser('alice', log('alice-1', 'alice', 1), 200);
    await repository.appendForUser('bob', log('bob-1', 'bob', 2), 200);

    await expect(repository.listForUser('alice', 200)).resolves.toEqual([
      log('alice-1', 'alice', 1),
    ]);
    await expect(repository.listForUser('bob', 200)).resolves.toEqual([
      log('bob-1', 'bob', 2),
    ]);
  });

  it('trims one user without affecting another user', async () => {
    const store = new MemoryLogStore();
    const repository = new WatchingUpdateCheckLogRepository(store);

    await repository.appendForUser('alice', log('alice-1', 'alice', 1), 2);
    await repository.appendForUser('alice', log('alice-2', 'alice', 2), 2);
    await repository.appendForUser('alice', log('alice-3', 'alice', 3), 2);
    await repository.appendForUser('bob', log('bob-1', 'bob', 4), 2);

    await expect(repository.listForUser('alice', 200)).resolves.toEqual([
      log('alice-3', 'alice', 3),
      log('alice-2', 'alice', 2),
    ]);
    await expect(repository.listForUser('bob', 200)).resolves.toEqual([
      log('bob-1', 'bob', 4),
    ]);
  });

  it('clears one user partition', async () => {
    const store = new MemoryLogStore();
    const repository = new WatchingUpdateCheckLogRepository(store);

    await repository.appendForUser('alice', log('alice-1', 'alice', 1), 200);
    await repository.appendForUser('bob', log('bob-1', 'bob', 2), 200);
    await repository.clearForUser('alice');

    await expect(repository.listForUser('alice', 200)).resolves.toEqual([]);
    await expect(repository.listForUser('bob', 200)).resolves.toHaveLength(1);
  });

  it('lists indexed user logs together when no user filter is provided', async () => {
    const store = new MemoryLogStore();
    const repository = new WatchingUpdateCheckLogRepository(store);

    await repository.appendForUser('alice', log('alice-1', 'alice', 1), 200);
    await repository.appendForUser('bob', log('bob-1', 'bob', 3), 200);

    await expect(repository.list(200)).resolves.toEqual([
      log('bob-1', 'bob', 3),
      log('alice-1', 'alice', 1),
    ]);
  });

  it('keeps trigger source logs readable and filterable', async () => {
    const store = new MemoryLogStore();
    const repository = new WatchingUpdateCheckLogRepository(store);
    const triggerLog: WatchingUpdateCheckLogEntry = {
      ...log('trigger-1', 'alice', 5),
      source: 'trigger',
      operation: 'manual-trigger',
      request: {
        method: 'POST',
        path: '/api/watching-updates/trigger',
        userId: 'alice',
        requestedBy: 'alice',
        trigger: 'manual',
        client: {},
      },
    };

    await repository.appendForUser('alice', triggerLog, 200);

    await expect(repository.list(200, { source: 'trigger' })).resolves.toEqual([
      triggerLog,
    ]);
  });

  it('keeps legacy v1 logs readable as a fallback', async () => {
    const store = new MemoryLogStore();
    const repository = new WatchingUpdateCheckLogRepository(store);
    await store.setCache(WATCHING_UPDATE_CHECK_LOG_CACHE_KEY, [
      log('legacy-1', 'alice', 1),
      log('legacy-2', 'bob', 2),
    ]);

    await expect(repository.listForUser('alice', 200)).resolves.toEqual([
      log('legacy-1', 'alice', 1),
    ]);
    await expect(repository.list(200)).resolves.toEqual([
      log('legacy-2', 'bob', 2),
      log('legacy-1', 'alice', 1),
    ]);
  });
});
