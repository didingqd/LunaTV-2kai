/** @jest-environment node */

import { WatchingUpdateCheckLogRepository } from './watching-update-check-log-repository';
import { WatchingUpdateCheckLogService } from './watching-update-check-log-service';
import type { WatchingUpdateCheckLogEntry } from './watching-update-check-log-types';

class MemoryLogStore {
  values = new Map<string, unknown>();

  async getCache(key: string): Promise<unknown | null> {
    return this.values.get(key) ?? null;
  }

  async setCache(key: string, data: unknown): Promise<void> {
    this.values.set(key, data);
  }
}

function configReader(updateCheckLogRetentionCount: number) {
  return {
    getUpdateCheckConfig: async () => ({
      updateCheckBackendEnabled: true,
      updateCheckSchedulerEnabled: true,
      updateCheckCronInterval: 30 * 60 * 1000,
      updateCheckCronExpression: '*/30 * * * *',
      updateCheckTimezone: 'UTC',
      updateCheckLogRetentionCount,
      updateCheckBatchSize: 100,
      updateCheckMaxUsers: 1000,
      updateCheckMaxFollowPerUser: 100,
    }),
  };
}

function failingConfigReader() {
  return {
    getUpdateCheckConfig: async () => {
      throw new Error('config unavailable');
    },
  };
}

function createService(updateCheckLogRetentionCount: number) {
  const store = new MemoryLogStore();
  const repository = new WatchingUpdateCheckLogRepository(store);
  return {
    service: new WatchingUpdateCheckLogService(
      repository,
      configReader(updateCheckLogRetentionCount),
    ),
    store,
  };
}

function createServiceWithFailingConfig() {
  const store = new MemoryLogStore();
  const repository = new WatchingUpdateCheckLogRepository(store);
  return {
    service: new WatchingUpdateCheckLogService(
      repository,
      failingConfigReader(),
    ),
    store,
  };
}

function baseLog(index: number): Omit<WatchingUpdateCheckLogEntry, 'id'> {
  return {
    source: 'cron',
    operation: 'scheduled-check',
    request: {
      method: 'GET',
      path: '/api/cron/update-checks',
      client: {},
    },
    execution: {
      startedAt: index,
      endedAt: index + 1,
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

async function recordMany(
  service: WatchingUpdateCheckLogService,
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    await service.record(baseLog(index));
  }
}

const previousStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

describe('WatchingUpdateCheckLogService retention', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
  });

  afterAll(() => {
    if (previousStorageType === undefined)
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = previousStorageType;
  });

  it('falls back to 200 when config cannot be read', async () => {
    const { service } = createServiceWithFailingConfig();

    await recordMany(service, 201);

    await expect(service.list({ limit: 5000 })).resolves.toHaveLength(200);
  });

  it('keeps only 50 logs when configured to 50', async () => {
    const { service } = createService(50);

    await recordMany(service, 60);

    await expect(service.list({ limit: 200 })).resolves.toHaveLength(50);
  });

  it('allows configured retention above the old 200 entry limit', async () => {
    const { service } = createService(5000);

    await recordMany(service, 201);

    await expect(service.list({ limit: 5000 })).resolves.toHaveLength(201);
  });

  it('normalizes retention below 50 to 50', async () => {
    const { service } = createService(10);

    await recordMany(service, 60);

    await expect(service.list({ limit: 5000 })).resolves.toHaveLength(50);
  });

  it('normalizes retention above 5000 to 5000', async () => {
    const { service } = createService(10000);

    await recordMany(service, 5001);

    await expect(service.list({ limit: 5000 })).resolves.toHaveLength(5000);
  });
});
