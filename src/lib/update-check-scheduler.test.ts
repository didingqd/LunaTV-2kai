/** @jest-environment node */

jest.mock('./latest-episode-provider', () => ({
  latestEpisodeProviderRegistry: { get: jest.fn() },
}));

import { UpdateCheckScheduler } from './update-check-scheduler';
import type { UpdateCheckTask } from './update-check-types';
import type { UpdateCheckTaskRepository } from './update-check-repository';
import type { SystemConfig } from './admin.types';
import type { UpdateCheckUserPermissionRepository } from './update-check-permission-repository';

const enabledConfig: SystemConfig = {
  updateCheckBackendEnabled: true,
  updateCheckBatchSize: 100,
  updateCheckMaxUsers: 1000,
  updateCheckMaxFollowPerUser: 100,
};

function permissionsFor(
  ...userIds: string[]
): UpdateCheckUserPermissionRepository {
  return {
    get: async () => null,
    getAll: async () => [],
    save: async () => undefined,
    listEnabledUserIds: async () => userIds,
  };
}

const task: UpdateCheckTask = {
  id: 'task-1',
  userId: 'alice',
  followId: 'follow-1',
  source: 'source-a',
  resourceId: 'video-1',
  nextCheckAt: 100,
  attempt: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe('UpdateCheckScheduler', () => {
  it('dispatches only due tasks and does not enumerate users', async () => {
    let listDueArguments: [number, number] | undefined;
    const tasks: UpdateCheckTaskRepository = {
      get: async () => task,
      save: async () => undefined,
      listDue: async (now, limit) => {
        listDueArguments = [now, limit];
        return [task];
      },
      delete: async () => undefined,
      deleteForUser: async () => undefined,
    };
    const checked: UpdateCheckTask[] = [];
    const service = {
      checkTask: async (value: UpdateCheckTask) => {
        checked.push(value);
        return {};
      },
    };

    const result = await new UpdateCheckScheduler(
      tasks,
      service as never,
      { getUpdateCheckConfig: async () => enabledConfig },
      permissionsFor('alice'),
    ).run({ now: 100, limit: 10 });

    expect(listDueArguments).toEqual([100, 10]);
    expect(checked).toEqual([task]);
    expect(result).toMatchObject({ inspected: 1, succeeded: 1, failed: 0 });
  });

  it('does not read due tasks when backend calculation is disabled', async () => {
    const listDue = jest.fn();
    const checkTask = jest.fn();
    const tasks = { listDue } as unknown as UpdateCheckTaskRepository;

    const result = await new UpdateCheckScheduler(
      tasks,
      { checkTask } as never,
      {
        getUpdateCheckConfig: async () => ({
          ...enabledConfig,
          updateCheckBackendEnabled: false,
        }),
      },
      permissionsFor('alice'),
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
    const dueTasks = [
      task,
      { ...task, id: 'task-2', followId: 'follow-2', resourceId: 'video-2' },
      { ...task, id: 'task-3', userId: 'bob', followId: 'follow-3' },
    ];
    const tasks = {
      listDue: async () => dueTasks,
    } as unknown as UpdateCheckTaskRepository;
    const checked: UpdateCheckTask[] = [];

    await new UpdateCheckScheduler(
      tasks,
      {
        checkTask: async (value: UpdateCheckTask) => {
          checked.push(value);
          return {};
        },
      } as never,
      {
        getUpdateCheckConfig: async () => ({
          ...enabledConfig,
          updateCheckMaxFollowPerUser: 1,
        }),
      },
      permissionsFor('alice'),
    ).run({ now: 100 });

    expect(checked.map((value) => value.id)).toEqual(['task-1']);
  });
});
