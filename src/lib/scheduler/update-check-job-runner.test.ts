/** @jest-environment node */

import type { UpdateCheckSchedulerResult } from '@/lib/update-check-scheduler';

import { UpdateCheckJobRunner } from './update-check-job-runner';

const schedulerResult: UpdateCheckSchedulerResult = {
  inspected: 3,
  succeeded: 2,
  failed: 1,
  oldestDueAt: 100,
};

function clock(...values: number[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe('UpdateCheckJobRunner', () => {
  it('runs the scheduler and returns its result unchanged', async () => {
    const run = jest.fn(async () => schedulerResult);
    const runner = new UpdateCheckJobRunner({ run }, clock(1_000, 1_025));

    const result = await runner.run({
      trigger: 'cron',
      requestedBy: 'system',
      limit: 25,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ limit: 25 });
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
    const runner = new UpdateCheckJobRunner({ run }, clock(1_000, 1_025));

    await runner.run({ trigger: 'cron', onTaskComplete });

    expect(run).toHaveBeenCalledWith({ onTaskComplete });
  });

  it('returns failure metadata when the scheduler throws', async () => {
    const runner = new UpdateCheckJobRunner(
      {
        run: async () => {
          throw new Error('scheduler failed');
        },
      },
      clock(2_000, 2_040),
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
  });

  it('rejects a concurrent run immediately without running the scheduler twice', async () => {
    let finish!: (value: UpdateCheckSchedulerResult) => void;
    const pending = new Promise<UpdateCheckSchedulerResult>((resolve) => {
      finish = resolve;
    });
    const run = jest.fn(() => pending);
    const runner = new UpdateCheckJobRunner(
      { run },
      clock(3_000, 3_010, 3_050),
    );

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
    const runner = new UpdateCheckJobRunner(
      { run },
      clock(4_000, 4_010, 4_020, 4_030),
    );

    const first = await runner.run({ trigger: 'cron' });
    const second = await runner.run({ trigger: 'cron' });

    expect(first.success).toBe(false);
    expect(second.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
