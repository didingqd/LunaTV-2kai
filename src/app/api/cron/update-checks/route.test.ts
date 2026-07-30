/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/scheduler/update-check-job-runner', () => ({
  updateCheckJobRunner: { run: jest.fn() },
}));
jest.mock('@/lib/update-check-scheduler', () => ({
  updateCheckScheduler: { run: jest.fn() },
}));
jest.mock('@/lib/watching-update-check-log-request', () => ({
  getWatchingUpdateCheckLogRequestContext: jest.fn(() => ({
    request: { ip: '127.0.0.1', userAgent: 'jest' },
  })),
}));
jest.mock('@/lib/watching-update-check-log-service', () => ({
  createWatchingUpdateCheckLogResult: jest.fn((value) => value),
  errorMessage: jest.fn((error) =>
    error instanceof Error ? error.message : String(error),
  ),
  watchingUpdateCheckLogService: { record: jest.fn() },
}));

import { updateCheckJobRunner } from '@/lib/scheduler/update-check-job-runner';
import { updateCheckScheduler } from '@/lib/update-check-scheduler';
import { watchingUpdateCheckLogService } from '@/lib/watching-update-check-log-service';
import { GET } from './route';

const runJob = updateCheckJobRunner.run as jest.Mock;
const runScheduler = updateCheckScheduler.run as jest.Mock;
const recordLog = watchingUpdateCheckLogService.record as jest.Mock;
const previousCronSecret = process.env.CRON_SECRET;

const schedulerResult = {
  inspected: 3,
  succeeded: 2,
  failed: 1,
  oldestDueAt: 1_700_000_000_000,
};

function request(secret = 'secret') {
  return new NextRequest('http://localhost/api/cron/update-checks', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

function jobResult(overrides: Record<string, unknown> = {}) {
  return {
    trigger: 'cron',
    requestedBy: 'vercel',
    startedAt: 100,
    finishedAt: 125,
    durationMs: 25,
    running: false,
    success: true,
    schedulerResult,
    ...overrides,
  };
}

describe('GET /api/cron/update-checks', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CRON_SECRET = 'secret';
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  afterAll(() => {
    process.env.CRON_SECRET = previousCronSecret;
  });

  it('calls the JobRunner when CRON_SECRET is valid', async () => {
    runJob.mockResolvedValue(jobResult());

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(runJob).toHaveBeenCalledWith({
      trigger: 'cron',
      requestedBy: 'vercel',
      onTaskComplete: expect.any(Function),
    });
  });

  it('returns 401 when CRON_SECRET is invalid', async () => {
    const response = await GET(request('wrong'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(runJob).not.toHaveBeenCalled();
  });

  it('returns the scheduler result and keeps compatible fields', async () => {
    runJob.mockResolvedValue(jobResult());

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      inspected: 3,
      succeeded: 2,
      failed: 1,
      oldestDueAt: 1_700_000_000_000,
      running: false,
      trigger: 'cron',
      durationMs: 25,
      startedAt: 100,
      finishedAt: 125,
    });
  });

  it('returns HTTP 200 when JobRunner reports already running', async () => {
    runJob.mockResolvedValue(
      jobResult({
        running: true,
        success: false,
        error: 'UPDATE_CHECK_ALREADY_RUNNING',
        schedulerResult: null,
      }),
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      running: true,
      inspected: 0,
      succeeded: 0,
      failed: 0,
      oldestDueAt: null,
    });
  });

  it('returns 500 when JobRunner throws', async () => {
    runJob.mockRejectedValue(new Error('boom'));

    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Update check scheduler failed',
    });
  });

  it('returns 500 when JobRunner returns a failed run', async () => {
    runJob.mockResolvedValue(
      jobResult({
        success: false,
        error: 'scheduler failed',
        schedulerResult: null,
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Update check scheduler failed',
    });
  });

  it('does not call UpdateCheckScheduler directly', async () => {
    runJob.mockResolvedValue(jobResult());

    await GET(request());

    expect(runScheduler).not.toHaveBeenCalled();
  });

  it('passes task results from the JobRunner callback into the cron audit log', async () => {
    runJob.mockImplementation(async ({ onTaskComplete }) => {
      await onTaskComplete?.({
        task: { id: 'task-1' },
        result: { userId: 'alice', followId: 'follow-1' },
      });
      return jobResult();
    });

    await GET(request());

    expect(recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'cron',
        operation: 'scheduled-check',
        result: expect.objectContaining({
          checkedCount: 3,
          successCount: 2,
          failureCount: 1,
          results: [{ userId: 'alice', followId: 'follow-1' }],
        }),
      }),
    );
  });
});
