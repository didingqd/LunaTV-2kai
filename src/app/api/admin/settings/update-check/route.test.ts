/** @jest-environment node */

import { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';

jest.mock('@/lib/admin-auth', () => ({
  getAdminRoleFromRequest: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  clearConfigCache: jest.fn(),
  getConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: { saveAdminConfig: jest.fn() },
}));
jest.mock('@/lib/scheduler/update-check-runtime', () => ({
  updateCheckRuntime: { handleSystemConfigChanged: jest.fn() },
}));
jest.mock('@/lib/update-check-permission-service', () => ({
  updateCheckPermissionService: { onSystemConfigChanged: jest.fn() },
}));

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { updateCheckPermissionService } from '@/lib/update-check-permission-service';
import { PUT } from './route';

const getRole = getAdminRoleFromRequest as jest.Mock;
const loadConfig = getConfig as jest.Mock;
const saveAdminConfig = db.saveAdminConfig as jest.Mock;
const handleSystemConfigChanged =
  updateCheckRuntime.handleSystemConfigChanged as jest.Mock;
const onSystemConfigChanged =
  updateCheckPermissionService.onSystemConfigChanged as jest.Mock;
const previousStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

describe('admin update check settings API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    getRole.mockResolvedValue('owner');
    loadConfig.mockResolvedValue(config());
  });

  afterAll(() => {
    if (previousStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = previousStorageType;
    }
  });

  it('updates only SystemConfig and preserves user-level watching config', async () => {
    const response = await PUT(
      request({
        updateCheckBackendEnabled: true,
        updateCheckSchedulerEnabled: true,
        updateCheckCronExpression: '0 * * * *',
        updateCheckTimezone: 'Asia/Shanghai',
        updateCheckLogRetentionCount: 500,
        updateCheckBatchSize: 50,
        updateCheckMaxUsers: 200,
        updateCheckMaxFollowPerUser: 25,
      }),
    );

    expect(response.status).toBe(200);
    const saved = saveAdminConfig.mock.calls[0][0] as AdminConfig;
    expect(saved.SystemConfig).toMatchObject({
      updateCheckBackendEnabled: true,
      updateCheckCronExpression: '0 * * * *',
      updateCheckLogRetentionCount: 500,
    });
    expect(saved.UserConfig.Users[0].watchingUpdateConfig).toEqual({
      cronExpression: '0 */6 * * *',
      timezone: 'Europe/Berlin',
    });
    expect(onSystemConfigChanged).toHaveBeenCalledWith(true);
    expect(handleSystemConfigChanged).toHaveBeenCalledWith(
      config().SystemConfig,
      expect.objectContaining({ updateCheckCronExpression: '0 * * * *' }),
    );
  });

  it('rejects invalid cron expressions', async () => {
    const response = await PUT(
      request({
        ...config().SystemConfig,
        updateCheckCronExpression: 'invalid',
      }),
    );

    expect(response.status).toBe(400);
    expect(saveAdminConfig).not.toHaveBeenCalled();
  });
});

function config(): AdminConfig {
  return {
    SystemConfig: {
      updateCheckBackendEnabled: false,
      updateCheckSchedulerEnabled: true,
      updateCheckCronExpression: '*/30 * * * *',
      updateCheckTimezone: 'UTC',
      updateCheckLogRetentionCount: 200,
      updateCheckBatchSize: 100,
      updateCheckMaxUsers: 1000,
      updateCheckMaxFollowPerUser: 100,
    },
    UserConfig: {
      Users: [
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
          watchingUpdateConfig: {
            cronExpression: '0 */6 * * *',
            timezone: 'Europe/Berlin',
          },
        },
      ],
    },
  } as AdminConfig;
}

function request(systemConfig: AdminConfig['SystemConfig']) {
  return new NextRequest('http://localhost/api/admin/settings/update-check', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemConfig }),
  });
}
