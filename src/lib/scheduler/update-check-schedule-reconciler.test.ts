/** @jest-environment node */

import type { AdminConfig } from '@/lib/admin.types';
import {
  CachedUpdateCheckTaskRepository,
  updateCheckTaskId,
} from '@/lib/update-check-repository';
import type { UpdateCheckTask } from '@/lib/update-check-types';

import { UpdateCheckScheduleReconciler } from './update-check-schedule-reconciler';

class MemoryCache {
  values = new Map<string, unknown>();

  async getCache(key: string) {
    return this.values.get(key) ?? null;
  }

  async setCache(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async deleteCache(key: string) {
    this.values.delete(key);
  }
}

function createTask(
  followId: string,
  nextCheckAt: number,
  username = 'alice',
): UpdateCheckTask {
  return {
    id: updateCheckTaskId(username, followId),
    userId: username,
    followId,
    source: 'source-a',
    resourceId: followId,
    nextCheckAt,
    attempt: 2,
    createdAt: 1,
    updatedAt: 2,
    lastSuccessAt: 3,
    lastErrorAt: 4,
    lastError: 'previous error',
  };
}

function createAdminConfig(): AdminConfig {
  return {
    SystemConfig: {
      updateCheckBackendEnabled: true,
      updateCheckSchedulerEnabled: true,
      updateCheckCronInterval: 30 * 60 * 1000,
      updateCheckCronExpression: '*/30 * * * *',
      updateCheckTimezone: 'UTC',
      updateCheckLogRetentionCount: 200,
      updateCheckBatchSize: 100,
      updateCheckMaxUsers: 1000,
      updateCheckMaxFollowPerUser: 100,
    },
    UserConfig: {
      Users: [
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
        },
      ],
    },
  } as AdminConfig;
}

describe('UpdateCheckScheduleReconciler', () => {
  it('reconciles every task for one user without changing other fields', async () => {
    const repository = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const first = createTask('follow-a', 100);
    const second = createTask('follow-b', 200);
    await repository.save(first);
    await repository.save(second);
    const reconciler = new UpdateCheckScheduleReconciler(
      repository,
      async () => createAdminConfig(),
      () => new Date('2026-07-30T12:01:00.000Z'),
      () => 'owner',
    );

    const result = await reconciler.reconcileUser('alice');
    const nextRunAt = new Date('2026-07-30T12:30:00.000Z').getTime();

    expect(result).toMatchObject({ taskCount: 2, updatedCount: 2 });
    expect(await repository.get(first.id)).toEqual({
      ...first,
      nextCheckAt: nextRunAt,
    });
    expect(await repository.get(second.id)).toEqual({
      ...second,
      nextCheckAt: nextRunAt,
    });
  });

  it('returns normally for a user without tasks', async () => {
    const repository = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const reconciler = new UpdateCheckScheduleReconciler(
      repository,
      async () => createAdminConfig(),
      () => new Date('2026-07-30T12:01:00.000Z'),
    );

    await expect(reconciler.reconcileUser('alice')).resolves.toMatchObject({
      taskCount: 0,
      updatedCount: 0,
    });
  });

  it('leaves tasks unchanged when the effective schedule is disabled', async () => {
    const repository = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const existing = createTask('follow-a', 100);
    await repository.save(existing);
    const config = createAdminConfig();
    config.UserConfig.Users[0].updateCheckBackendEnabled = false;
    const reconciler = new UpdateCheckScheduleReconciler(
      repository,
      async () => config,
      () => new Date('2026-07-30T12:01:00.000Z'),
    );

    const result = await reconciler.reconcileUser('alice');

    expect(result).toMatchObject({ taskCount: 1, updatedCount: 0 });
    expect(await repository.get(existing.id)).toEqual(existing);
  });

  it('reconciles users inheriting a changed system schedule field', async () => {
    const repository = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const inherited = createTask('follow-a', 100);
    const overridden = createTask('follow-b', 200, 'bob');
    await repository.save(inherited);
    await repository.save(overridden);
    const config = createAdminConfig();
    config.UserConfig.Users.push({
      username: 'bob',
      role: 'user',
      updateCheckBackendEnabled: true,
      watchingUpdateConfig: { cronExpression: '0 */6 * * *' },
    });
    const reconciler = new UpdateCheckScheduleReconciler(
      repository,
      async () => config,
      () => new Date('2026-07-30T12:01:00.000Z'),
    );

    const results =
      await reconciler.reconcileUsersInheritingSystemSchedule('cron');

    expect(results).toHaveLength(1);
    expect(results[0].schedule.username).toBe('alice');
    expect(await repository.get(inherited.id)).toEqual({
      ...inherited,
      nextCheckAt: new Date('2026-07-30T12:30:00.000Z').getTime(),
    });
    expect(await repository.get(overridden.id)).toEqual(overridden);
  });
});
