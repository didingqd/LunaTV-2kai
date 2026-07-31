/** @jest-environment node */

import { SchedulerManager } from './scheduler-manager';
import {
  UpdateCheckJobRunner,
  type UpdateCheckJobRunnerResult,
} from './update-check-job-runner';

function jobResult(
  overrides: Partial<UpdateCheckJobRunnerResult> = {},
): UpdateCheckJobRunnerResult {
  return {
    trigger: 'cron',
    startedAt: 0,
    finishedAt: 0,
    durationMs: 0,
    running: false,
    success: true,
    schedulerResult: {
      inspected: 0,
      succeeded: 0,
      failed: 0,
      oldestDueAt: null,
    },
    ...overrides,
  };
}

async function flushTimers(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe('SchedulerManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not start duplicate timers', async () => {
    const { manager, tasks } = createManager({ earliest: 60_000 });

    manager.start();
    manager.start();
    await flushTimers();

    expect(tasks.findEarliestNextCheckAt).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('reload recalculates the wait time', async () => {
    let now = 1_000;
    const { manager, tasks, jobRunner } = createManager({
      earliest: 61_000,
      now: () => now,
    });

    manager.start();
    await flushTimers();

    tasks.findEarliestNextCheckAt.mockResolvedValue(2_000);
    manager.reload();
    await flushTimers();

    jest.advanceTimersByTime(999);
    await flushTimers();
    expect(jobRunner.run).not.toHaveBeenCalled();

    now = 2_000;
    jest.advanceTimersByTime(1);
    await flushTimers();
    expect(jobRunner.run).toHaveBeenCalledWith({ trigger: 'cron' });
  });

  it('stop clears the timer', async () => {
    const { manager, jobRunner } = createManager({ earliest: 1_000 });

    manager.start();
    await flushTimers();
    manager.stop();

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(1_000);
    await flushTimers();
    expect(jobRunner.run).not.toHaveBeenCalled();
  });

  it('dispose releases scheduled resources', async () => {
    const { manager, jobRunner } = createManager({ earliest: 1_000 });

    manager.start();
    await flushTimers();
    manager.dispose();

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(1_000);
    await flushTimers();
    expect(jobRunner.run).not.toHaveBeenCalled();
  });

  it('wakes every 60 seconds without running the job when no tasks exist', async () => {
    const { manager, jobRunner } = createManager({ earliest: null });

    manager.start();
    await flushTimers();

    jest.advanceTimersByTime(59_999);
    await flushTimers();
    expect(jobRunner.run).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await flushTimers();
    expect(jobRunner.run).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('does not write a cron audit log when no task is due', async () => {
    const auditLogger = { record: jest.fn().mockResolvedValue('audit-1') };
    const scheduler = { run: jest.fn() };
    const jobRunner = new UpdateCheckJobRunner(scheduler, () => 0, auditLogger);
    const manager = new SchedulerManager({
      tasks: { findEarliestNextCheckAt: jest.fn().mockResolvedValue(null) },
      jobRunner,
      loadEnabled: jest.fn().mockResolvedValue(true),
      now: () => 0,
      logger: { debug: jest.fn(), error: jest.fn() },
    });

    manager.start();
    await flushTimers();
    jest.advanceTimersByTime(60_000);
    await flushTimers();
    manager.stop();

    expect(scheduler.run).not.toHaveBeenCalled();
    expect(auditLogger.record).not.toHaveBeenCalled();
  });

  it('reload wakes earlier when a new earlier task appears', async () => {
    let now = 0;
    const { manager, tasks, jobRunner } = createManager({
      earliest: 60_000,
      now: () => now,
    });

    manager.start();
    await flushTimers();

    tasks.findEarliestNextCheckAt.mockResolvedValue(5_000);
    manager.reload();
    await flushTimers();

    jest.advanceTimersByTime(4_999);
    await flushTimers();
    expect(jobRunner.run).not.toHaveBeenCalled();

    now = 5_000;
    jest.advanceTimersByTime(1);
    await flushTimers();
    expect(jobRunner.run).toHaveBeenCalledTimes(1);
  });

  it('keeps scheduling when the job runner reports an active run', async () => {
    const { manager, tasks, jobRunner } = createManager({
      earliest: 0,
      jobResult: jobResult({
        running: true,
        success: false,
        error: 'UPDATE_CHECK_ALREADY_RUNNING',
        schedulerResult: null,
      }),
    });
    tasks.findEarliestNextCheckAt
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(60_000);

    manager.start();
    await flushTimers();
    jest.advanceTimersByTime(0);
    await flushTimers();

    expect(jobRunner.run).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('triggers cron audit logs when the Docker scheduler wakes', async () => {
    const auditLogger = { record: jest.fn().mockResolvedValue('audit-1') };
    const scheduler = {
      run: jest.fn().mockResolvedValue({
        inspected: 0,
        succeeded: 0,
        failed: 0,
        oldestDueAt: null,
      }),
    };
    const jobRunner = new UpdateCheckJobRunner(
      scheduler,
      (() => {
        const values = [100, 120];
        let index = 0;
        return () => values[Math.min(index++, values.length - 1)];
      })(),
      auditLogger,
    );
    const manager = new SchedulerManager({
      tasks: { findEarliestNextCheckAt: jest.fn().mockResolvedValue(0) },
      jobRunner,
      loadEnabled: jest.fn().mockResolvedValue(true),
      now: () => 0,
      logger: { debug: jest.fn(), error: jest.fn() },
    });

    manager.start();
    await flushTimers();
    jest.advanceTimersByTime(0);
    await flushTimers();
    manager.stop();

    expect(scheduler.run).toHaveBeenCalledTimes(1);
    expect(auditLogger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'cron',
        operation: 'scheduled-check',
        request: expect.objectContaining({
          method: 'SCHEDULED',
          path: 'scheduler://update-checks',
          trigger: 'cron',
        }),
        execution: expect.objectContaining({ stage: 'finished' }),
      }),
      { id: 'audit-1', replaceExisting: true },
    );
  });

  it('continues after the job runner throws', async () => {
    const { manager, tasks, jobRunner } = createManager({ earliest: 0 });
    jobRunner.run.mockRejectedValueOnce(new Error('boom'));
    tasks.findEarliestNextCheckAt
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(60_000);

    manager.start();
    await flushTimers();
    jest.advanceTimersByTime(0);
    await flushTimers();

    expect(jobRunner.run).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });
});

function createManager(options: {
  earliest: number | null;
  now?: () => number;
  jobResult?: UpdateCheckJobRunnerResult;
}) {
  const tasks = {
    findEarliestNextCheckAt: jest.fn().mockResolvedValue(options.earliest),
  };
  const jobRunner = {
    run: jest.fn().mockResolvedValue(options.jobResult ?? jobResult()),
  };
  const manager = new SchedulerManager({
    tasks,
    jobRunner,
    loadEnabled: jest.fn().mockResolvedValue(true),
    now: options.now ?? (() => 0),
    logger: { debug: jest.fn(), error: jest.fn() },
  });
  return { manager, tasks, jobRunner };
}
