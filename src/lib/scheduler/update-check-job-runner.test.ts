/** @jest-environment node */

import type { UpdateCheckSchedulerResult } from '@/lib/update-check-scheduler';
import type { UpdateCheckTask, UpdateResult } from '@/lib/update-check-types';

import { UpdateCheckJobRunner } from './update-check-job-runner';

const schedulerResult: UpdateCheckSchedulerResult = {
  inspected: 3,
  succeeded: 2,
  failed: 1,
  oldestDueAt: 100,
};

const auditTask: UpdateCheckTask = {
  id: 'task-1',
  userId: 'alice',
  followId: 'follow-1',
  source: 'douban',
  resourceId: 'resource-1',
  nextCheckAt: 100,
  attempt: 0,
  createdAt: 90,
  updatedAt: 95,
};

const auditResult: UpdateResult = {
  userId: 'alice',
  followId: 'follow-1',
  source: 'douban',
  resourceId: 'resource-1',
  title: '????',
  latestEpisode: 2,
  watchedEpisode: 1,
  unwatchedCount: 1,
  hasUpdate: true,
  checkedAt: 120,
  expireAt: 220,
  status: 'stale',
  revision: 1,
  metadata: {
    algorithmVersion: 1,
    completionThreshold: 0,
    baselineEpisode: 1,
    effectiveLatestEpisode: 2,
    releasedEpisodeCount: 2,
  },
};

function clock(...values: number[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function noAuditRunner(
  run:
    | jest.Mock
    | { run: jest.Mock | (() => Promise<UpdateCheckSchedulerResult>) },
  now: () => number,
) {
  const scheduler = 'run' in run ? run : { run };
  return new UpdateCheckJobRunner(scheduler, now, null);
}

describe('UpdateCheckJobRunner', () => {
  it('runs the scheduler and returns its result unchanged', async () => {
    const run = jest.fn(async () => schedulerResult);
    const runner = noAuditRunner(run, clock(1_000, 1_025));

    const result = await runner.run({
      trigger: 'cron',
      requestedBy: 'system',
      limit: 25,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      limit: 25,
      onTaskComplete: expect.any(Function),
    });
    expect(result).toEqual({
      trigger: 'cron',
      requestedBy: 'system',
      startedAt: 1_000,
      finishedAt: 1_025,
      durationMs: 25,
      running: false,
      success: true,
      schedulerResult,
    });
    expect(result.schedulerResult).toBe(schedulerResult);
  });

  it('passes task completion callback through to the scheduler', async () => {
    const run = jest.fn(async () => schedulerResult);
    const onTaskComplete = jest.fn();
    const runner = noAuditRunner(run, clock(1_000, 1_025));

    await runner.run({ trigger: 'cron', onTaskComplete });

    const schedulerOptions = (run as jest.Mock).mock.calls[0]?.[0] as {
      onTaskComplete?: (value: {
        task: UpdateCheckTask;
        result: UpdateResult | null;
      }) => Promise<void>;
    };
    const wrappedCallback = schedulerOptions.onTaskComplete;
    expect(wrappedCallback).toEqual(expect.any(Function));
    await wrappedCallback?.({ task: auditTask, result: auditResult });
    expect(onTaskComplete).toHaveBeenCalledWith({
      task: auditTask,
      result: auditResult,
    });
  });

  it('records start and finish audit logs around the scheduler run', async () => {
    const auditLogger = { record: jest.fn().mockResolvedValue('audit-1') };
    const run = jest.fn(async ({ onTaskComplete }) => {
      await onTaskComplete({ task: auditTask, result: auditResult });
      return schedulerResult;
    });
    const runner = new UpdateCheckJobRunner(
      { run },
      clock(1_000, 1_025),
      auditLogger,
    );

    await runner.run({ trigger: 'cron', requestedBy: 'docker' });

    expect(auditLogger.record).toHaveBeenCalledTimes(2);
    expect(auditLogger.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        source: 'cron',
        operation: 'scheduled-check',
        request: expect.objectContaining({
          method: 'SCHEDULED',
          path: 'scheduler://update-checks',
          requestedBy: 'docker',
          trigger: 'cron',
        }),
        execution: expect.objectContaining({
          stage: 'started',
          startedAt: 1_000,
          finishedAt: 1_000,
          success: true,
        }),
      }),
      {},
    );
    expect(auditLogger.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        source: 'cron',
        operation: 'scheduled-check',
        execution: expect.objectContaining({
          stage: 'finished',
          startedAt: 1_000,
          finishedAt: 1_025,
          durationMs: 25,
          success: true,
        }),
        result: expect.objectContaining({
          checkedCount: 3,
          successCount: 2,
          failureCount: 1,
          updateFoundCount: 1,
        }),
      }),
      {
        id: 'audit-1',
        replaceExisting: true,
        userIds: ['alice'],
      },
    );
    expect(auditLogger.record.mock.calls[1]?.[0].result).toMatchObject({
      trigger: 'cron',
      checkedUsers: ['alice'],
      updatedUsers: ['alice'],
      failedUsers: [],
      result: schedulerResult,
    });
  });

  it('returns failure metadata when the scheduler throws', async () => {
    const auditLogger = { record: jest.fn().mockResolvedValue('audit-2') };
    const runner = new UpdateCheckJobRunner(
      {
        run: jest.fn(async () => {
          throw new Error('scheduler failed');
        }),
      },
      clock(2_000, 2_040),
      auditLogger,
    );

    await expect(runner.run({ trigger: 'cron' })).resolves.toEqual({
      trigger: 'cron',
      startedAt: 2_000,
      finishedAt: 2_040,
      durationMs: 40,
      running: false,
      success: false,
      error: 'scheduler failed',
      schedulerResult: null,
    });
    expect(auditLogger.record).toHaveBeenCalledTimes(2);
    expect(auditLogger.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        execution: expect.objectContaining({
          stage: 'finished',
          success: false,
          error: 'scheduler failed',
        }),
        result: expect.objectContaining({
          trigger: 'cron',
          result: null,
        }),
      }),
      { id: 'audit-2', replaceExisting: true },
    );
  });

  it('rejects a concurrent run immediately without running the scheduler twice', async () => {
    let finish!: (value: UpdateCheckSchedulerResult) => void;
    const pending = new Promise<UpdateCheckSchedulerResult>((resolve) => {
      finish = resolve;
    });
    const run = jest.fn(() => pending);
    const runner = noAuditRunner(run, clock(3_000, 3_010, 3_050));

    const firstRun = runner.run({ trigger: 'cron' });
    const secondResult = await runner.run({
      trigger: 'manual',
      requestedBy: 'admin',
    });

    expect(secondResult).toEqual({
      trigger: 'manual',
      requestedBy: 'admin',
      startedAt: 3_010,
      finishedAt: 3_010,
      durationMs: 0,
      running: true,
      success: false,
      error: 'UPDATE_CHECK_ALREADY_RUNNING',
      schedulerResult: null,
    });
    expect(run).toHaveBeenCalledTimes(1);

    finish(schedulerResult);
    await expect(firstRun).resolves.toMatchObject({
      trigger: 'cron',
      success: true,
      schedulerResult,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('releases single-flight after a failed run', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(schedulerResult);
    const runner = noAuditRunner(run, clock(4_000, 4_010, 4_020, 4_030));

    const first = await runner.run({ trigger: 'cron' });
    const second = await runner.run({ trigger: 'cron' });

    expect(first.success).toBe(false);
    expect(second.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
