/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/admin-auth', () => ({
  getAdminRoleFromRequest: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/scheduler/scheduler-manager', () => ({
  schedulerManager: { runNow: jest.fn() },
}));
jest.mock('@/lib/watching-update-check-log-request', () => ({
  getWatchingUpdateCheckLogRequestContext: jest.fn(() => ({
    request: {
      method: 'POST',
      path: '/api/admin/watching-updates/run-now',
      client: { platform: 'Windows' },
    },
  })),
}));

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { schedulerManager } from '@/lib/scheduler/scheduler-manager';
import { POST } from './route';

const getRole = getAdminRoleFromRequest as jest.Mock;
const getAuth = getAuthInfoFromCookie as jest.Mock;
const runNow = schedulerManager.runNow as jest.Mock;

function request() {
  return new NextRequest(
    'http://localhost/api/admin/watching-updates/run-now',
    {
      method: 'POST',
    },
  );
}

describe('POST /api/admin/watching-updates/run-now', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRole.mockResolvedValue('admin');
    getAuth.mockReturnValue({ username: 'alice' });
    runNow.mockResolvedValue({
      trigger: 'manual',
      requestedBy: 'alice',
      startedAt: 100,
      finishedAt: 140,
      durationMs: 40,
      running: false,
      success: true,
      schedulerResult: {
        inspected: 3,
        succeeded: 2,
        failed: 1,
        oldestDueAt: 200,
        dataSourceCount: 2,
        updateFoundCount: 1,
        notificationCount: 4,
        skipped: 5,
      },
    });
  });

  it('runs the shared job runner in immediate manual mode', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(runNow).toHaveBeenCalledWith({
      trigger: 'manual',
      requestedBy: 'alice',
      ignoreSchedule: true,
      preserveNextCheckAt: true,
      audit: {
        source: 'admin',
        operation: 'manual-trigger',
        request: {
          method: 'POST',
          path: '/api/admin/watching-updates/run-now',
          client: { platform: 'Windows' },
          requestedBy: 'alice',
          trigger: 'manual',
        },
      },
    });
  });

  it('returns the Run Now statistics', async () => {
    const response = await POST(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      running: false,
      checkedCount: 3,
      dataSourceCount: 2,
      updateFoundCount: 1,
      updateSuccessCount: 2,
      notificationCount: 4,
      skippedCount: 5,
      failedCount: 1,
      durationMs: 40,
    });
  });

  it('rejects non-admin callers', async () => {
    getRole.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(runNow).not.toHaveBeenCalled();
  });
});
