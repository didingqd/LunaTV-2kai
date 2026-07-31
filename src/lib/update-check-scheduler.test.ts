/** @jest-environment node */

jest.mock('./latest-episode-provider', () => ({
  latestEpisodeProviderRegistry: { get: jest.fn() },
}));

import type { AdminConfig, SystemConfig } from './admin.types';
import type {
  NotificationDispatchResult,
  NotificationMessage,
} from './notification/notification-types';
import { UpdateCheckJobRunner } from './scheduler/update-check-job-runner';
import {
  CachedUpdateCheckTaskRepository,
  type UpdateCheckScheduleTaskRepository,
  type UpdateCheckTaskRepository,
} from './update-check-repository';
import { UpdateCheckScheduler } from './update-check-scheduler';
import type { UpdateCheckTask, UpdateResult } from './update-check-types';

const enabledConfig: SystemConfig = {
  updateCheckBackendEnabled: true,
  updateCheckSchedulerEnabled: true,
  updateCheckCronExpression: '*/30 * * * *',
  updateCheckTimezone: 'UTC',
  updateCheckLogRetentionCount: 200,
  updateCheckBatchSize: 100,
  updateCheckMaxUsers: 1000,
  updateCheckMaxFollowPerUser: 100,
};

const runAt = new Date('2026-07-30T12:01:00.000Z').getTime();

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

type SchedulerTasks = UpdateCheckTaskRepository &
  Pick<
    UpdateCheckScheduleTaskRepository,
    'listTasksByUser' | 'batchUpdateNextCheckAt'
  >;

const noopNotifications = {
  dispatch: async () => dispatchSuccess(),
};

function permissionsFor(...userIds: string[]) {
  return {
    listUpdateCheckEnabledUserIds: async () => userIds,
  };
}

function createTask(overrides: Partial<UpdateCheckTask> = {}): UpdateCheckTask {
  return {
    id: 'task-1',
    userId: 'alice',
    followId: 'follow-1',
    source: 'source-a',
    resourceId: 'video-1',
    nextCheckAt: 100,
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createAdminConfig(
  users: AdminConfig['UserConfig']['Users'] = [
    {
      username: 'alice',
      role: 'user',
      updateCheckBackendEnabled: true,
    },
  ],
): AdminConfig {
  return {
    SystemConfig: enabledConfig,
    UserConfig: { Users: users },
  } as AdminConfig;
}

function successfulService(
  tasks: SchedulerTasks,
  checkedAt = runAt,
  result: UpdateResult | null = {} as UpdateResult,
) {
  return {
    checkTask: async (task: UpdateCheckTask) => {
      await tasks.save({
        ...task,
        nextCheckAt: checkedAt + 1,
        attempt: 0,
        updatedAt: checkedAt,
        lastSuccessAt: checkedAt,
        lastError: undefined,
      });
      return result;
    },
  };
}

function createScheduler(
  tasks: SchedulerTasks,
  service: { checkTask(task: UpdateCheckTask): Promise<UpdateResult | null> },
  options: {
    settings?: SystemConfig;
    users?: AdminConfig['UserConfig']['Users'];
    permissions?: string[];
    notifications?: {
      dispatch(message: NotificationMessage): Promise<{
        success: boolean;
        totalChannels: number;
        succeeded: number;
        failed: number;
        errors: Array<{ channel: string; message: string }>;
      }>;
    };
  } = {},
) {
  return new UpdateCheckScheduler(
    tasks,
    service as never,
    {
      getUpdateCheckConfig: async () => options.settings ?? enabledConfig,
    },
    permissionsFor(...(options.permissions ?? ['alice'])),
    async () => createAdminConfig(options.users),
    options.notifications ?? noopNotifications,
  );
}

describe('UpdateCheckScheduler', () => {
  it('dispatches only due tasks and does not enumerate users', async () => {
    let listDueArguments: [number, number] | undefined;
    const task = createTask();
    const tasks: SchedulerTasks = {
      get: async () => task,
      save: async () => undefined,
      listDue: async (now, limit) => {
        listDueArguments = [now, limit];
        return [task];
      },
      listTasksByUser: async () => [task],
      batchUpdateNextCheckAt: async () => 1,
      delete: async () => undefined,
      deleteForUser: async () => undefined,
    };
    const checked: UpdateCheckTask[] = [];

    const result = await createScheduler(tasks, {
      checkTask: async (value) => {
        checked.push(value);
        return {} as UpdateResult;
      },
    }).run({ now: 100, limit: 10 });

    expect(listDueArguments).toEqual([100, 10]);
    expect(checked).toEqual([task]);
    expect(result).toMatchObject({ inspected: 1, succeeded: 1, failed: 0 });
  });

  it('does not read due tasks when backend calculation is disabled', async () => {
    const listDue = jest.fn();
    const checkTask = jest.fn();
    const tasks = { listDue } as unknown as SchedulerTasks;

    const result = await createScheduler(
      tasks,
      { checkTask },
      {
        settings: { ...enabledConfig, updateCheckBackendEnabled: false },
      },
    ).run({ now: 100 });

    expect(listDue).not.toHaveBeenCalled();
    expect(checkTask).not.toHaveBeenCalled();
    expect(result).toEqual({
      inspected: 0,
      succeeded: 0,
      failed: 0,
      oldestDueAt: null,
    });
  });

  it('only dispatches authorized users within configured limits', async () => {
    const first = createTask();
    const dueTasks = [
      first,
      createTask({ id: 'task-2', followId: 'follow-2' }),
      createTask({ id: 'task-3', userId: 'bob', followId: 'follow-3' }),
    ];
    const tasks = {
      get: async (id: string) =>
        dueTasks.find((task) => task.id === id) ?? null,
      listDue: async () => dueTasks,
      listTasksByUser: async () => [],
      batchUpdateNextCheckAt: async () => 0,
    } as unknown as SchedulerTasks;
    const checked: UpdateCheckTask[] = [];

    await createScheduler(
      tasks,
      {
        checkTask: async (value) => {
          checked.push(value);
          return {} as UpdateResult;
        },
      },
      {
        settings: { ...enabledConfig, updateCheckMaxFollowPerUser: 1 },
      },
    ).run({ now: 100 });

    expect(checked.map((value) => value.id)).toEqual(['task-1']);
  });

  it('uses a user cron after a successful check', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    await tasks.save(task);

    await createScheduler(tasks, successfulService(tasks), {
      users: [
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
          watchingUpdateConfig: { cronExpression: '*/5 * * * *' },
        },
      ],
    }).run({ now: runAt });

    expect((await tasks.get(task.id))?.nextCheckAt).toBe(
      new Date('2026-07-30T12:05:00.000Z').getTime(),
    );
  });

  it('inherits the system cron when the user has no override', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    await tasks.save(task);

    await createScheduler(tasks, successfulService(tasks)).run({ now: runAt });

    expect((await tasks.get(task.id))?.nextCheckAt).toBe(
      new Date('2026-07-30T12:30:00.000Z').getTime(),
    );
  });

  it('uses the user timezone when calculating the next run', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    await tasks.save(task);

    await createScheduler(tasks, successfulService(tasks), {
      users: [
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
          watchingUpdateConfig: {
            cronExpression: '0 0 * * *',
            timezone: 'Asia/Shanghai',
          },
        },
      ],
    }).run({ now: runAt });

    expect((await tasks.get(task.id))?.nextCheckAt).toBe(
      new Date('2026-07-30T16:00:00.000Z').getTime(),
    );
  });

  it('treats the owner as implicitly authorized', async () => {
    const originalOwner = process.env.USERNAME;
    process.env.USERNAME = 'owner';
    try {
      const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
      const task = createTask({ userId: 'owner' });
      await tasks.save(task);

      await createScheduler(tasks, successfulService(tasks), {
        users: [],
        permissions: [],
      }).run({ now: runAt });

      expect((await tasks.get(task.id))?.nextCheckAt).toBe(
        new Date('2026-07-30T12:30:00.000Z').getTime(),
      );
    } finally {
      if (originalOwner === undefined) delete process.env.USERNAME;
      else process.env.USERNAME = originalOwner;
    }
  });

  it('skips a task when the user permission is disabled', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    await tasks.save(task);
    const checkTask = jest.fn();

    const result = await createScheduler(
      tasks,
      { checkTask },
      {
        permissions: [],
      },
    ).run({ now: runAt });

    expect(checkTask).not.toHaveBeenCalled();
    expect(await tasks.get(task.id)).toEqual(task);
    expect(result.inspected).toBe(0);
  });

  it('preserves the existing failure backoff and error state', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    await tasks.save(task);
    const failedTask = {
      ...task,
      nextCheckAt: runAt + 5 * 60 * 1000,
      attempt: 1,
      updatedAt: runAt,
      lastErrorAt: runAt,
      lastError: 'provider failed',
    };

    await createScheduler(tasks, {
      checkTask: async () => {
        await tasks.save(failedTask);
        return null;
      },
    }).run({ now: runAt });

    expect(await tasks.get(task.id)).toEqual(failedTask);
  });

  it('overrides the service-level next run after a successful check', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    await tasks.save(task);

    await createScheduler(tasks, successfulService(tasks), {
      users: [
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
          watchingUpdateConfig: { cronExpression: '0 */6 * * *' },
        },
      ],
    }).run({ now: runAt });

    expect((await tasks.get(task.id))?.nextCheckAt).toBe(
      new Date('2026-07-30T18:00:00.000Z').getTime(),
    );
    expect((await tasks.get(task.id))?.nextCheckAt).not.toBe(runAt + 1);
  });

  it('reschedules a successful task even when its result is null', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    await tasks.save(task);

    await createScheduler(tasks, successfulService(tasks, runAt, null)).run({
      now: runAt,
    });

    expect((await tasks.get(task.id))?.nextCheckAt).toBe(
      new Date('2026-07-30T12:30:00.000Z').getTime(),
    );
  });

  it('does not overwrite nextCheckAt when lastSuccessAt is unchanged', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask({ lastSuccessAt: 50 });
    await tasks.save(task);
    const unchanged = { ...task, nextCheckAt: 777 };

    await createScheduler(tasks, {
      checkTask: async () => {
        await tasks.save(unchanged);
        return null;
      },
    }).run({ now: runAt });

    expect(await tasks.get(task.id)).toEqual(unchanged);
  });

  it('does not overwrite a failed task when another task for the user succeeds', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const succeeded = createTask();
    const failed = createTask({ id: 'task-2', followId: 'follow-2' });
    await tasks.save(succeeded);
    await tasks.save(failed);
    const failedAfterRun = {
      ...failed,
      nextCheckAt: runAt + 5 * 60 * 1000,
      attempt: 1,
      updatedAt: runAt,
      lastErrorAt: runAt,
      lastError: 'provider failed',
    };

    await createScheduler(tasks, {
      checkTask: async (task) => {
        if (task.id === failed.id) {
          await tasks.save(failedAfterRun);
          return null;
        }
        return successfulService(tasks).checkTask(task);
      },
    }).run({ now: runAt });

    expect((await tasks.get(succeeded.id))?.nextCheckAt).toBe(
      new Date('2026-07-30T12:30:00.000Z').getTime(),
    );
    expect(await tasks.get(failed.id)).toEqual(failedAfterRun);
  });

  it('keeps scheduler behavior when invoked through the job runner', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    await tasks.save(task);
    const scheduler = createScheduler(tasks, successfulService(tasks));
    const runner = new UpdateCheckJobRunner(
      scheduler,
      (() => {
        const values = [1_000, 1_020];
        return () => values.shift() ?? 1_020;
      })(),
    );

    const result = await runner.run({ trigger: 'cron', limit: 10 });

    expect(result).toMatchObject({
      trigger: 'cron',
      durationMs: 20,
      running: false,
      success: true,
      schedulerResult: {
        inspected: 1,
        succeeded: 1,
        failed: 0,
      },
    });
    expect((await tasks.get(task.id))?.nextCheckAt).toBe(
      new Date('2026-07-30T12:30:00.000Z').getTime(),
    );
  });

  it('sends a notification when a check finds new episodes', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const dispatch = createDispatch();
    await tasks.save(task);

    await createScheduler(
      tasks,
      successfulService(tasks, runAt, updateResult({ hasUpdate: true })),
      {
        notifications: { dispatch },
      },
    ).run({ now: runAt });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      userId: 'alice',
      type: 'WATCHING_UPDATE_FOUND',
      title: '《Demo Show》发现更新',
      content:
        'Source A 已从 10 集更新到 12 集，检查时间：2026-07-30T12:01:00.000Z',
      createdAt: runAt,
      payload: {
        resourceId: 'video-1',
        source: 'source-a',
        previousEpisode: 10,
        latestEpisode: 12,
        releasedEpisodeCount: 2,
        taskId: 'task-1',
        followId: 'follow-1',
        checkedAt: runAt,
      },
    });
  });

  it('does not send a notification when no update is found', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const dispatch = createDispatch();
    await tasks.save(task);

    await createScheduler(
      tasks,
      successfulService(tasks, runAt, updateResult()),
      {
        notifications: { dispatch },
      },
    ).run({ now: runAt });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sends a failure notification when the task error changes', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const dispatch = createDispatch();
    await tasks.save(task);

    await createScheduler(
      tasks,
      {
        checkTask: async () => {
          await tasks.save({
            ...task,
            nextCheckAt: runAt + 5 * 60 * 1000,
            attempt: 1,
            updatedAt: runAt,
            lastErrorAt: runAt,
            lastError:
              'Error: Provider timeout https://example.com/detail Authorization: Bearer secret Cookie: sid=1',
          });
          return null;
        },
      },
      {
        notifications: { dispatch },
      },
    ).run({ now: runAt });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      userId: 'alice',
      type: 'WATCHING_UPDATE_FAILED',
      title: '追更检查失败',
      content:
        'source-a 来源的资源 video-1 检查失败：Provider timeout [redacted-url] Authorization: [redacted] Cookie: [redacted]。检查时间：2026-07-30T12:01:00.000Z',
      createdAt: runAt,
      payload: {
        resourceId: 'video-1',
        source: 'source-a',
        taskId: 'task-1',
        followId: 'follow-1',
        failedAt: runAt,
        error:
          'Provider timeout [redacted-url] Authorization: [redacted] Cookie: [redacted]',
      },
    });
    expect(JSON.stringify(dispatch.mock.calls[0][0])).not.toContain(
      'https://example.com',
    );
    expect(JSON.stringify(dispatch.mock.calls[0][0])).not.toContain(
      'Bearer secret',
    );
    expect(JSON.stringify(dispatch.mock.calls[0][0])).not.toContain('sid=1');
  });

  it('does not fail the scheduler when notification dispatch throws', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const dispatch = jest.fn<
      Promise<NotificationDispatchResult>,
      [NotificationMessage]
    >(async () => {
      throw new Error('dispatcher failed');
    });
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await tasks.save(task);

    const result = await createScheduler(
      tasks,
      successfulService(tasks, runAt, updateResult({ hasUpdate: true })),
      {
        notifications: { dispatch },
      },
    ).run({ now: runAt });

    expect(result).toMatchObject({
      inspected: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Update check notification dispatch threw',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('keeps job runner success when notification dispatch fails', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const dispatch = createDispatch({
      success: false,
      totalChannels: 1,
      succeeded: 0,
      failed: 1,
      errors: [{ channel: 'inbox', message: 'inbox failed' }],
    });
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await tasks.save(task);
    const scheduler = createScheduler(
      tasks,
      successfulService(tasks, runAt, updateResult({ hasUpdate: true })),
      {
        notifications: { dispatch },
      },
    );
    const runner = new UpdateCheckJobRunner(
      scheduler,
      (() => {
        const values = [1_000, 1_020];
        return () => values.shift() ?? 1_020;
      })(),
    );

    const result = await runner.run({ trigger: 'cron' });

    expect(result).toMatchObject({
      trigger: 'cron',
      running: false,
      success: true,
      schedulerResult: {
        inspected: 1,
        succeeded: 1,
        failed: 0,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Update check notification dispatch failed',
      [{ channel: 'inbox', message: 'inbox failed' }],
    );
    errorSpy.mockRestore();
  });
});

function updateResult(overrides: Partial<UpdateResult> = {}): UpdateResult {
  return {
    userId: 'alice',
    followId: 'follow-1',
    source: 'source-a',
    resourceId: 'video-1',
    title: 'Demo Show',
    latestEpisode: 12,
    watchedEpisode: 10,
    unwatchedCount: 2,
    hasUpdate: false,
    checkedAt: runAt,
    expireAt: runAt + 60 * 60 * 1000,
    status: 'fresh',
    revision: 1,
    metadata: {
      algorithmVersion: 1,
      completionThreshold: 0.9,
      baselineEpisode: 10,
      effectiveLatestEpisode: 12,
      releasedEpisodeCount: 2,
      sourceName: 'Source A',
    },
    ...overrides,
  };
}

function createDispatch(
  result: NotificationDispatchResult = dispatchSuccess(),
) {
  return jest.fn<Promise<NotificationDispatchResult>, [NotificationMessage]>(
    async () => result,
  );
}

function dispatchSuccess(): NotificationDispatchResult {
  return {
    success: true,
    totalChannels: 1,
    succeeded: 1,
    failed: 0,
    errors: [],
  };
}
