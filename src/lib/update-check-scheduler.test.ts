/** @jest-environment node */

jest.mock('./latest-episode-provider', () => ({
  latestEpisodeProviderRegistry: { get: jest.fn() },
}));

import { UpdateCheckScheduler } from './update-check-scheduler';
import type { UpdateCheckTask } from './update-check-types';
import type { UpdateCheckTaskRepository } from './update-check-repository';

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

    const result = await new UpdateCheckScheduler(tasks, service as never).run({
      now: 100,
      limit: 10,
    });

    expect(listDueArguments).toEqual([100, 10]);
    expect(checked).toEqual([task]);
    expect(result).toMatchObject({ inspected: 1, succeeded: 1, failed: 0 });
  });
});
