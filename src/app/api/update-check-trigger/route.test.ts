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
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
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
      mode: 'user',
      trigger: 'trigger-link',
      triggerSource: 'external_http',
      userId: 'alice',
      tokenId: 'token-1',
      requestedBy: 'alice',
      preserveNextCheckAt: true,
      audit: {
        source: 'trigger',
        operation: 'manual-trigger',
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
          updates: [
            {
              resourceId: 'resource-1',
              title: '九门',
              oldEpisode: 6,
              newEpisode: 10,
              source: 'aqyzy',
            },
          ],
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
        updates: [
          {
            resourceId: 'resource-1',
            title: '九门',
            oldEpisode: 6,
            newEpisode: 10,
            source: 'aqyzy',
          },
        ],
      },
      checkedCount: 3,
      updateFoundCount: 1,
      updates: [
        {
          resourceId: 'resource-1',
          title: '九门',
          oldEpisode: 6,
          newEpisode: 10,
          source: 'aqyzy',
        },
      ],
    });
  });

  it('renders completed notification display data as a simple HTML result page', async () => {
    getStatus.mockReturnValue(
      status({
        status: 'completed',
        running: false,
        finishedAt: 150,
        durationMs: 50,
        result: {
          inspected: 3,
          succeeded: 3,
          failed: 0,
          oldestDueAt: 90,
          dataSourceCount: 2,
          updateFoundCount: 2,
          notificationCount: 1,
          skipped: 0,
        },
        displayResults: [
          {
            userId: 'alice',
            title: '更新提醒',
            newUpdates: [
              {
                followId: 'follow-1',
                title: '九门',
                fromEpisode: 6,
                toEpisode: 10,
              },
            ],
            updated: [
              {
                followId: 'follow-2',
                title: '穹庐下的魔女',
                fromEpisode: 5,
                toEpisode: 6,
              },
            ],
            checkedAt: 150,
            timezone: 'Asia/Shanghai',
            displayTime: '2026-08-02 12:30:01',
          },
        ],
      }),
    );

    const response = await GET(
      request(
        'http://localhost/api/update-check-trigger?status=1',
        'token.secret',
        {
          accept: 'text/html',
        },
      ),
    );
    const html = await response.text();

    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(html).toContain('🆕 新更新（1）');
    expect(html).toContain('✅ 已更新（1）');
    expect(html).toContain('九门');
    expect(html).toContain('6 → 10 集（+4）');
    expect(html).toContain('穹庐下的魔女');
    expect(html).toContain('检测时间：2026-08-02 12:30:01');
    expect(html).not.toContain('推送渠道');
    expect(html).not.toContain('通知历史');
  });

  it('renders updateFound results as new updates when display data is empty', async () => {
    getStatus.mockReturnValue(
      status({
        status: 'completed',
        running: false,
        finishedAt: 150,
        durationMs: 50,
        result: {
          inspected: 1,
          succeeded: 1,
          failed: 0,
          oldestDueAt: 90,
          dataSourceCount: 1,
          updateFoundCount: 1,
          updates: [
            {
              resourceId: 'resource-1',
              title: '九门',
              oldEpisode: 6,
              newEpisode: 10,
              source: 'aqyzy',
            },
          ],
          notificationCount: 0,
          skipped: 0,
        },
        displayResults: [
          {
            userId: 'alice',
            title: '更新提醒',
            newUpdates: [],
            updated: [],
            checkedAt: 150,
            timezone: 'Asia/Shanghai',
            displayTime: '2026-08-02 12:30:01',
          },
        ],
      }),
    );

    const response = await GET(
      request(
        'http://localhost/api/update-check-trigger?status=1',
        'token.secret',
        {
          accept: 'text/html',
        },
      ),
    );
    const html = await response.text();

    expect(html).toContain('🆕 新更新（1）');
    expect(html).toContain('九门');
    expect(html).toContain('6 → 10 集（+4）');
    expect(html).not.toContain('✅ 已更新');
    expect(html).not.toContain('暂无更新');
  });

  it('renders updated-only display data without a new update section', async () => {
    getStatus.mockReturnValue(
      status({
        status: 'completed',
        running: false,
        finishedAt: 150,
        durationMs: 50,
        result: {
          inspected: 1,
          succeeded: 1,
          failed: 0,
          oldestDueAt: 90,
          dataSourceCount: 1,
          updateFoundCount: 0,
          updates: [],
          notificationCount: 0,
          skipped: 0,
        },
        displayResults: [
          {
            userId: 'alice',
            title: '更新提醒',
            newUpdates: [],
            updated: [
              {
                followId: 'follow-2',
                title: '相反的你和我第二季',
                fromEpisode: 4,
                toEpisode: 5,
              },
            ],
            checkedAt: 150,
            timezone: 'Asia/Shanghai',
            displayTime: '2026-08-02 12:30:01',
          },
        ],
      }),
    );

    const response = await GET(
      request(
        'http://localhost/api/update-check-trigger?status=1',
        'token.secret',
        {
          accept: 'text/html',
        },
      ),
    );
    const html = await response.text();

    expect(html).toContain('✅ 已更新（1）');
    expect(html).toContain('相反的你和我第二季');
    expect(html).toContain('4 → 5 集（+1）');
    expect(html).not.toContain('🆕 新更新');
    expect(html).not.toContain('暂无更新');
  });

  it('prefers a non-empty display result over an earlier empty display result for the same user', async () => {
    getStatus.mockReturnValue(
      status({
        status: 'completed',
        running: false,
        finishedAt: 150,
        durationMs: 50,
        result: {
          inspected: 2,
          succeeded: 2,
          failed: 0,
          oldestDueAt: 90,
          dataSourceCount: 1,
          updateFoundCount: 0,
          updates: [],
          notificationCount: 1,
          skipped: 0,
        },
        displayResults: [
          {
            userId: 'alice',
            title: '更新提醒',
            newUpdates: [],
            updated: [],
            checkedAt: 149,
            timezone: 'Asia/Shanghai',
            displayTime: '2026-08-02 12:29:01',
          },
          {
            userId: 'alice',
            title: '更新提醒',
            newUpdates: [
              {
                followId: 'follow-1',
                title: '九门',
                fromEpisode: 6,
                toEpisode: 10,
              },
            ],
            updated: [
              {
                followId: 'follow-2',
                title: '相反的你和我第二季',
                fromEpisode: 4,
                toEpisode: 5,
              },
            ],
            checkedAt: 150,
            timezone: 'Asia/Shanghai',
            displayTime: '2026-08-02 12:30:01',
          },
        ],
      }),
    );

    const response = await GET(
      request(
        'http://localhost/api/update-check-trigger?status=1',
        'token.secret',
        {
          accept: 'text/html',
        },
      ),
    );
    const html = await response.text();

    expect(html).toContain('🆕 新更新（1）');
    expect(html).toContain('✅ 已更新（1）');
    expect(html).toContain('九门');
    expect(html).toContain('相反的你和我第二季');
    expect(html).toContain('检测时间：2026-08-02 12:30:01');
    expect(html).not.toContain('暂无更新');
  });

  it('uses forwarded origin for the HTML status refresh URL', async () => {
    getStatus.mockReturnValue(
      status({ taskId: null, status: 'idle', running: false }),
    );
    runInBackground.mockReturnValue(status());

    const response = await GET(
      request(
        'http://0.0.0.0:3000/api/update-check-trigger?token=query.secret',
        '',
        {
          accept: 'text/html',
          'x-forwarded-host': 'a.com',
          'x-forwarded-proto': 'https',
        },
      ),
    );
    const html = await response.text();

    expect(html).toContain(
      'content="3;url=https://a.com/api/update-check-trigger?token=query.secret&amp;status=1"',
    );
    expect(html).not.toContain('0.0.0.0:3000');
    expect(html).not.toContain('localhost');
  });

  it('renders an empty HTML result without a zero-count new update section', async () => {
    getStatus.mockReturnValue(
      status({
        status: 'completed',
        running: false,
        finishedAt: 150,
        durationMs: 50,
        result: {
          inspected: 1,
          succeeded: 1,
          failed: 0,
          oldestDueAt: 90,
          dataSourceCount: 1,
          updateFoundCount: 0,
          notificationCount: 0,
          skipped: 0,
        },
        displayResults: [
          {
            userId: 'alice',
            title: '更新提醒',
            newUpdates: [],
            updated: [],
            checkedAt: 150,
            timezone: 'Asia/Shanghai',
            displayTime: '2026-08-02 12:30:01',
          },
        ],
      }),
    );

    const response = await GET(
      request(
        'http://localhost/api/update-check-trigger?status=1',
        'token.secret',
        {
          accept: 'text/html',
        },
      ),
    );
    const html = await response.text();

    expect(html).toContain('暂无更新');
    expect(html).not.toContain('新更新（0）');
  });
});
