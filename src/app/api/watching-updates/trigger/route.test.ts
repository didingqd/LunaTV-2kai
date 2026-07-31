/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/trigger-token-service', () => ({
  triggerTokenService: {
    verify: jest.fn(),
  },
}));
jest.mock('@/lib/manual-trigger-use-case', () => {
  class ManualTriggerUseCaseError extends Error {
    constructor(readonly code: string) {
      super(code);
      this.name = 'ManualTriggerUseCaseError';
    }
  }
  return {
    manualTriggerUseCase: {
      execute: jest.fn(),
    },
    ManualTriggerUseCaseError,
  };
});
jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: {
    checkTask: jest.fn(),
  },
}));
jest.mock('@/lib/watching-update-check-log-service', () => ({
  createWatchingUpdateCheckLogResult: jest.fn((value) => ({
    checkedCount: value.checkedCount,
    successCount: value.successCount,
    failureCount: value.failureCount,
    updateFoundCount: 0,
    updates: [],
  })),
  watchingUpdateCheckLogService: { record: jest.fn() },
}));

import {
  manualTriggerUseCase,
  ManualTriggerUseCaseError,
} from '@/lib/manual-trigger-use-case';
import { triggerTokenService } from '@/lib/trigger-token-service';
import { updateCheckService } from '@/lib/update-check-service';
import { watchingUpdateCheckLogService } from '@/lib/watching-update-check-log-service';
import { POST } from './route';

const verify = triggerTokenService.verify as jest.Mock;
const execute = manualTriggerUseCase.execute as jest.Mock;
const checkTask = updateCheckService.checkTask as jest.Mock;
const recordLog = watchingUpdateCheckLogService.record as jest.Mock;

const verified = { tokenId: 'token-1', userId: 'alice', lastUsedAt: 2000 };
const schedulerResult = {
  inspected: 2,
  succeeded: 1,
  failed: 1,
  oldestDueAt: 1500,
};
const jobResult = {
  trigger: 'manual',
  requestedBy: 'alice',
  startedAt: 1000,
  finishedAt: 1300,
  durationMs: 300,
  running: false,
  success: true,
  schedulerResult,
};

describe('watching updates external trigger API', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    verify.mockResolvedValue(verified);
    execute.mockResolvedValue({ jobResult });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('executes a manual trigger with Authorization Bearer token', async () => {
    const response = await POST(request({ authorization: 'Bearer token.secret' }));

    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledWith('token.secret');
    expect(execute).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({
        auditRequest: expect.objectContaining({
          method: 'POST',
          path: '/api/watching-updates/trigger',
          userId: 'alice',
          requestedBy: 'alice',
          trigger: 'manual',
        }),
      }),
    );
    expect(checkTask).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      running: false,
      trigger: 'manual',
      startedAt: 1000,
      finishedAt: 1300,
      durationMs: 300,
      inspected: 2,
      succeeded: 1,
      failed: 1,
      oldestDueAt: 1500,
    });
    expect(recordLog).not.toHaveBeenCalled();
  });

  it('executes with X-Trigger-Token header', async () => {
    const response = await POST(request({ 'x-trigger-token': 'token.secret' }));

    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledWith('token.secret');
    expect(execute).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({
        auditRequest: expect.objectContaining({
          userId: 'alice',
          requestedBy: 'alice',
          trigger: 'manual',
        }),
      }),
    );
  });

  it('does not accept cookies or username input', async () => {
    const response = await POST(
      request(
        { cookie: 'auth=whatever' },
        { username: 'alice', token: 'token.secret' },
      ),
    );

    expect(response.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is missing or invalid', async () => {
    const missing = await POST(request({}));
    verify.mockRejectedValueOnce(new Error('TRIGGER_TOKEN_INVALID'));
    const invalid = await POST(request({ authorization: 'Bearer bad.token' }));

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
    expect(recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'trigger',
        operation: 'manual-trigger',
        execution: expect.objectContaining({
          stage: 'finished',
          success: false,
          error: 'TRIGGER_TOKEN_NOT_FOUND',
        }),
      }),
      {},
    );
    expect(recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'trigger',
        operation: 'manual-trigger',
        execution: expect.objectContaining({
          error: 'TRIGGER_TOKEN_INVALID',
        }),
      }),
      {},
    );
  });

  it('returns 401 for disabled and expired tokens', async () => {
    verify.mockRejectedValueOnce(new Error('TRIGGER_TOKEN_DISABLED'));
    const disabled = await POST(request({ authorization: 'Bearer token.secret' }));
    verify.mockRejectedValueOnce(new Error('TRIGGER_TOKEN_EXPIRED'));
    const expired = await POST(request({ authorization: 'Bearer token.secret' }));

    expect(disabled.status).toBe(401);
    expect(expired.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns 403 when trigger permissions are insufficient', async () => {
    execute.mockRejectedValueOnce(
      new ManualTriggerUseCaseError('TRIGGER_LINK_NOT_ALLOWED'),
    );

    const response = await POST(request({ authorization: 'Bearer token.secret' }));

    expect(response.status).toBe(403);
    expect(recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'trigger',
        operation: 'manual-trigger',
        request: expect.objectContaining({ userId: 'alice' }),
        execution: expect.objectContaining({
          success: false,
          error: 'TRIGGER_LINK_NOT_ALLOWED',
        }),
      }),
      { userIds: ['alice'] },
    );
  });

  it('returns 403 when update checks or scheduler are disabled', async () => {
    execute.mockRejectedValueOnce(
      new ManualTriggerUseCaseError('WATCHING_UPDATE_NOT_ALLOWED'),
    );
    const updateDisabled = await POST(
      request({ authorization: 'Bearer token.secret' }),
    );
    execute.mockRejectedValueOnce(
      new ManualTriggerUseCaseError('SCHEDULER_DISABLED'),
    );
    const schedulerDisabled = await POST(
      request({ authorization: 'Bearer token.secret' }),
    );

    expect(updateDisabled.status).toBe(403);
    expect(schedulerDisabled.status).toBe(403);
  });

  it('returns 404 when the token user no longer exists', async () => {
    execute.mockRejectedValueOnce(new ManualTriggerUseCaseError('USER_NOT_FOUND'));

    const response = await POST(request({ authorization: 'Bearer token.secret' }));

    expect(response.status).toBe(404);
  });

  it('returns 200 running=true for JobRunner single-flight', async () => {
    execute.mockResolvedValueOnce({
      jobResult: {
        ...jobResult,
        running: true,
        success: false,
        error: 'UPDATE_CHECK_ALREADY_RUNNING',
        schedulerResult: null,
      },
    });

    const response = await POST(request({ authorization: 'Bearer token.secret' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      running: true,
      trigger: 'manual',
    });
  });

  it('returns 500 when verification or execution fails unexpectedly', async () => {
    verify.mockRejectedValueOnce(new Error('boom'));
    const verifyFailure = await POST(
      request({ authorization: 'Bearer token.secret' }),
    );
    verify.mockResolvedValueOnce(verified);
    execute.mockRejectedValueOnce(new Error('boom'));
    const executeFailure = await POST(
      request({ authorization: 'Bearer token.secret' }),
    );

    expect(verifyFailure.status).toBe(500);
    expect(executeFailure.status).toBe(500);
  });

  it('returns 500 when JobRunner reports a non single-flight failure', async () => {
    execute.mockResolvedValueOnce({
      jobResult: {
        ...jobResult,
        success: false,
        error: 'scheduler failed',
        schedulerResult: null,
      },
    });

    const response = await POST(request({ authorization: 'Bearer token.secret' }));

    expect(response.status).toBe(500);
  });
});

function request(headers: Record<string, string>, body?: unknown) {
  return new NextRequest('http://localhost/api/watching-updates/trigger', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
