/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/scheduler/update-check-job-runner', () => ({
  updateCheckJobRunner: {
    getStatus: jest.fn(),
    runInBackground: jest.fn(),
  },
}));
jest.mock('@/lib/trigger-token-service', () => ({
  triggerTokenService: { verify: jest.fn() },
}));
jest.mock('@/lib/trigger-link-access-control-service', () => ({
  triggerLinkAccessControlService: {
    authorize: jest.fn(),
  },
}));
jest.mock('@/lib/watching-update-check-log-request', () => ({
  getWatchingUpdateCheckLogRequestContext: jest.fn((_request, userId) => ({
    request: {
      method: 'GET',
      path: '/api/update-check-trigger',
      ...(userId ? { userId } : {}),
      client: {
        platform: 'server',
        ip: '203.0.113.1',
        userAgent: 'jest-agent',
      },
    },
  })),
}));

import { updateCheckJobRunner } from '@/lib/scheduler/update-check-job-runner';
import { triggerLinkAccessControlService } from '@/lib/trigger-link-access-control-service';
import { triggerTokenService } from '@/lib/trigger-token-service';
import { GET } from './route';

const getStatus = updateCheckJobRunner.getStatus as jest.Mock;
const runInBackground = updateCheckJobRunner.runInBackground as jest.Mock;
const authorizeAccess = triggerLinkAccessControlService.authorize as jest.Mock;
const verifyToken = triggerTokenService.verify as jest.Mock;

function request(
  url = 'http://localhost/api/update-check-trigger',
  token = 'token.secret',
) {
  return new NextRequest(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    status: 'running',
    running: true,
    trigger: 'cron',
    triggerSource: 'external_http',
    tokenId: 'token-1',
    userId: 'alice',
    requestedBy: 'alice',
    startedAt: 100,
    finishedAt: null,
    durationMs: null,
    result: null,
    ...overrides,
  };
}

describe('GET /api/update-check-trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockResolvedValue({
      tokenId: 'token-1',
      userId: 'alice',
      lastUsedAt: 90,
    });
    authorizeAccess.mockResolvedValue({ allowed: true });
  });

  it('starts the shared JobRunner in the background when idle', async () => {
    getStatus.mockReturnValue(
      status({ taskId: null, status: 'idle', running: false }),
    );
    runInBackground.mockReturnValue(status());

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(runInBackground).toHaveBeenCalledWith({
      trigger: 'cron',
      triggerSource: 'external_http',
      tokenId: 'token-1',
      requestedBy: 'alice',
      audit: {
        source: 'trigger',
        operation: 'scheduled-check',
        request: {
          method: 'GET',
          path: '/api/update-check-trigger',
          userId: 'alice',
          client: {
            platform: 'server',
            ip: '203.0.113.1',
            userAgent: 'jest-agent',
          },
          tokenId: 'token-1',
          requestedBy: 'alice',
          trigger: 'external_http',
        },
        userIds: ['alice'],
      },
    });
    expect(body).toMatchObject({
      success: true,
      accepted: true,
      status: 'running',
      running: true,
      taskId: 'task-1',
      triggerSource: 'external_http',
      tokenId: 'token-1',
      userId: 'alice',
      requestedBy: 'alice',
      startedAt: 100,
    });
  });

  it('accepts a query token for external schedulers', async () => {
    getStatus.mockReturnValue(
      status({ taskId: null, status: 'idle', running: false }),
    );
    runInBackground.mockReturnValue(status());

    await GET(
      request(
        'http://localhost/api/update-check-trigger?token=query.secret',
        '',
      ),
    );

    expect(verifyToken).toHaveBeenCalledWith('query.secret');
    expect(runInBackground).toHaveBeenCalledTimes(1);
  });

  it('rejects access-control violations before triggering', async () => {
    authorizeAccess.mockResolvedValue({
      allowed: false,
      error: 'ip_blocked',
      status: 429,
      autoDisabled: true,
    });

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(authorizeAccess).toHaveBeenCalledWith({
      tokenId: 'token-1',
      userId: 'alice',
      ip: '203.0.113.1',
      userAgent: 'jest-agent',
    });
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'ip_blocked',
      triggerLinkDisabled: true,
    });
    expect(runInBackground).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid tokens without triggering', async () => {
    verifyToken.mockRejectedValue(new Error('TRIGGER_TOKEN_INVALID'));

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'invalid_token',
    });
    expect(runInBackground).not.toHaveBeenCalled();
  });

  it('returns the active task without starting a duplicate run', async () => {
    getStatus.mockReturnValue(status({ taskId: 'active-task' }));

    const response = await GET(request());

    expect(runInBackground).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      accepted: false,
      status: 'running',
      taskId: 'active-task',
    });
  });

  it('can return the recent completed status without triggering', async () => {
    getStatus.mockReturnValue(
      status({
        status: 'completed',
        running: false,
        finishedAt: 150,
        durationMs: 50,
        result: {
          inspected: 3,
          succeeded: 2,
          failed: 1,
          oldestDueAt: 90,
          dataSourceCount: 2,
          updateFoundCount: 1,
          notificationCount: 1,
          skipped: 0,
        },
      }),
    );

    const response = await GET(
      request('http://localhost/api/update-check-trigger?status=1'),
    );

    expect(runInBackground).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      accepted: false,
      status: 'completed',
      finishedAt: 150,
      durationMs: 50,
      result: {
        inspected: 3,
        updateFoundCount: 1,
      },
    });
  });
});
