/** @jest-environment node */

jest.mock('./latest-episode-provider', () => ({
  latestEpisodeProviderRegistry: { get: jest.fn() },
}));

import type { AdminConfig, SystemConfig } from './admin.types';
import type {
  NotificationDispatchResult,
  NotificationEvent,
} from './notification/notification-types';
import { UpdateCheckJobRunner } from './scheduler/update-check-job-runner';
import {
  CachedWatchingUpdateNotificationStateRepository,
  CachedUpdateCheckTaskRepository,
  type UpdateCheckScheduleTaskRepository,
  type UpdateCheckTaskRepository,
  type WatchingUpdateNotificationStateRepository,
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
  dispatchEvent: async () => dispatchSuccess(),
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
  result: UpdateResult | null = updateResult(),
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
      dispatchEvent(event: NotificationEvent): Promise<{
        success: boolean;
        totalChannels: number;
        succeeded: number;
        failed: number;
        errors: Array<{ channel: string; message: string }>;
      }>;
    };
    notificationState?: WatchingUpdateNotificationStateRepository;
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
    options.notificationState ??
      new CachedWatchingUpdateNotificationStateRepository(new MemoryCache()),
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

  it('sends one summary notification from the effective latest episode', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const dispatch = createDispatch();
    const notificationState =
      new CachedWatchingUpdateNotificationStateRepository(new MemoryCache());
    await tasks.save(task);
    await notificationState.save('alice', {
      snapshots: [{ followId: 'follow-1', episode: 100 }],
      history: [],
    });

    await createScheduler(
      tasks,
      successfulService(
        tasks,
        runAt,
        updateResult({
          latestEpisode: 99,
          metadata: {
            ...updateResult().metadata,
            effectiveLatestEpisode: 101,
          },
        }),
      ),
      {
        notifications: { dispatchEvent: dispatch },
        notificationState,
      },
    ).run({ now: runAt });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      id: '',
      type: 'watching.update_found',
      userId: 'alice',
      createdAt: runAt,
      data: {
        title: '更新提醒',
        message:
          '更新提醒\n\n【新更新】\n\nDemo Show    100集 → 101集\n\n检查时间：\n2026-07-30 12:01',
        content:
          '更新提醒\n\n【新更新】\n\nDemo Show    100集 → 101集\n\n检查时间：\n2026-07-30 12:01',
        source: 'update-check',
        timestamp: runAt,
        metadata: {
          newUpdates: [
            {
              followId: 'follow-1',
              title: 'Demo Show',
              fromEpisode: 100,
              toEpisode: 101,
            },
          ],
          updatedHistory: [],
          checkedAt: runAt,
          timezone: 'UTC',
        },
      },
    });
  });

  it('does not notify for the first completed check and stores its baseline', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const dispatch = createDispatch();
    const notificationState =
      new CachedWatchingUpdateNotificationStateRepository(new MemoryCache());
    await tasks.save(task);

    await createScheduler(
      tasks,
      successfulService(
        tasks,
        runAt,
        updateResult({
          latestEpisode: 99,
          metadata: {
            ...updateResult().metadata,
            effectiveLatestEpisode: 100,
          },
        }),
      ),
      {
        notifications: { dispatchEvent: dispatch },
        notificationState,
      },
    ).run({ now: runAt });

    expect(dispatch).not.toHaveBeenCalled();
    expect(await notificationState.get('alice')).toEqual({
      snapshots: [{ followId: 'follow-1', episode: 100 }],
      history: [],
    });
  });

  it('does not send a notification when the effective episode snapshot is unchanged', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const dispatch = createDispatch();
    const notificationState =
      new CachedWatchingUpdateNotificationStateRepository(new MemoryCache());
    await tasks.save(task);
    await notificationState.save('alice', {
      snapshots: [{ followId: 'follow-1', episode: 12 }],
      history: [
        {
          followId: 'follow-1',
          fromEpisode: 10,
          toEpisode: 12,
          updatedAt: '2026-07-30T12:00:00.000Z',
        },
      ],
    });

    await createScheduler(
      tasks,
      successfulService(tasks, runAt, updateResult()),
      {
        notifications: { dispatchEvent: dispatch },
        notificationState,
      },
    ).run({ now: runAt });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('merges updates for multiple titles into one notification', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const first = createTask({
      id: 'task-one-piece',
      followId: 'follow-one-piece',
      resourceId: 'one-piece',
    });
    const second = createTask({
      id: 'task-naruto',
      followId: 'follow-naruto',
      resourceId: 'naruto',
    });
    const dispatch = createDispatch();
    const notificationState =
      new CachedWatchingUpdateNotificationStateRepository(new MemoryCache());
    await tasks.save(first);
    await tasks.save(second);
    await notificationState.save('alice', {
      snapshots: [
        { followId: 'follow-one-piece', episode: 11 },
        { followId: 'follow-naruto', episode: 13 },
      ],
      history: [],
    });

    await createScheduler(
      tasks,
      {
        checkTask: async (task) => {
          await tasks.save({
            ...task,
            nextCheckAt: runAt + 1,
            updatedAt: runAt,
            lastSuccessAt: runAt,
          });
          return updateResult({
            followId: task.followId,
            resourceId: task.resourceId,
            title: task.resourceId === 'one-piece' ? '海贼王' : '火影忍者',
            latestEpisode: task.resourceId === 'one-piece' ? 8 : 9,
            metadata: {
              ...updateResult().metadata,
              effectiveLatestEpisode: task.resourceId === 'one-piece' ? 12 : 14,
            },
          });
        },
      },
      {
        notifications: { dispatchEvent: dispatch },
        notificationState,
      },
    ).run({ now: runAt });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'watching.update_found',
      data: {
        title: '更新提醒',
        content: expect.stringContaining(
          '海贼王    11集 → 12集\n火影忍者    13集 → 14集',
        ),
      },
    });
  });

  it('keeps notification state unchanged when dispatch fails so the next check retries it', async () => {
    const tasks = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const task = createTask();
    const notificationState =
      new CachedWatchingUpdateNotificationStateRepository(new MemoryCache());
    const failedDispatch = createDispatch({
      success: false,
      totalChannels: 1,
      succeeded: 0,
      failed: 1,
      errors: [{ channel: 'webhook', message: 'unavailable' }],
    });
    await tasks.save(task);
    await notificationState.save('alice', {
      snapshots: [{ followId: 'follow-1', episode: 100 }],
      history: [],
    });
    const nextResult = updateResult({
      metadata: {
        ...updateResult().metadata,
        effectiveLatestEpisode: 101,
      },
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    await createScheduler(tasks, successfulService(tasks, runAt, nextResult), {
      notifications: { dispatchEvent: failedDispatch },
      notificationState,
    }).run({ now: runAt });

    expect(await notificationState.get('alice')).toEqual({
      snapshots: [{ followId: 'follow-1', episode: 100 }],
      history: [],
    });

    await tasks.save({ ...task, nextCheckAt: runAt });
    const successfulDispatch = createDispatch();
    await createScheduler(
      tasks,
      successfulService(tasks, runAt + 1, nextResult),
      {
        notifications: { dispatchEvent: successfulDispatch },
        notificationState,
      },
    ).run({ now: runAt + 1 });

    expect(successfulDispatch).toHaveBeenCalledTimes(1);
    expect(await notificationState.get('alice')).toEqual({
      snapshots: [{ followId: 'follow-1', episode: 101 }],
      history: [
        {
          followId: 'follow-1',
          fromEpisode: 100,
          toEpisode: 101,
          updatedAt: '2026-07-30T12:01:00.000Z',
        },
      ],
    });
    errorSpy.mockRestore();
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
        notifications: { dispatchEvent: dispatch },
      },
    ).run({ now: runAt });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      id: '',
      type: 'watching.update_failed',
      userId: 'alice',
      createdAt: runAt,
      data: {
        title: '追更检查失败',
        message:
          'source-a 来源的资源 video-1 检查失败：Provider timeout [redacted-url] Authorization: [redacted] Cookie: [redacted]。检查时间：2026-07-30T12:01:00.000Z',
        content:
          'source-a 来源的资源 video-1 检查失败：Provider timeout [redacted-url] Authorization: [redacted] Cookie: [redacted]。检查时间：2026-07-30T12:01:00.000Z',
        error:
          'Provider timeout [redacted-url] Authorization: [redacted] Cookie: [redacted]',
        source: 'update-check',
        timestamp: runAt,
        metadata: {
          resourceId: 'video-1',
          taskSource: 'source-a',
          taskId: 'task-1',
          followId: 'follow-1',
          failedAt: runAt,
          error:
            'Provider timeout [redacted-url] Authorization: [redacted] Cookie: [redacted]',
        },
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
    const notificationState =
      new CachedWatchingUpdateNotificationStateRepository(new MemoryCache());
    const dispatch = jest.fn<
      Promise<NotificationDispatchResult>,
      [NotificationEvent]
    >(async () => {
      throw new Error('dispatcher failed');
    });
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await tasks.save(task);
    await notificationState.save('alice', {
      snapshots: [{ followId: 'follow-1', episode: 11 }],
      history: [],
    });

    const result = await createScheduler(
      tasks,
      successfulService(tasks, runAt, updateResult({ hasUpdate: true })),
      {
        notifications: { dispatchEvent: dispatch },
        notificationState,
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
    const notificationState =
      new CachedWatchingUpdateNotificationStateRepository(new MemoryCache());
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
    await notificationState.save('alice', {
      snapshots: [{ followId: 'follow-1', episode: 11 }],
      history: [],
    });
    const scheduler = createScheduler(
      tasks,
      successfulService(tasks, runAt, updateResult({ hasUpdate: true })),
      {
        notifications: { dispatchEvent: dispatch },
        notificationState,
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
  return jest.fn<Promise<NotificationDispatchResult>, [NotificationEvent]>(
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
