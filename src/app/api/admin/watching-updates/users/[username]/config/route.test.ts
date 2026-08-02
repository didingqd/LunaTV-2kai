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
  db: {
    saveAdminConfig: jest.fn(),
  },
}));
jest.mock('@/lib/scheduler/update-check-runtime', () => ({
  updateCheckRuntime: {
    reconcileUser: jest.fn(),
  },
}));
jest.mock('@/lib/user-watching-update-config-service', () => ({
  userWatchingUpdateConfigService: {
    getUserWatchingUpdateConfig: jest.fn(),
    updateUserWatchingUpdateConfig: jest.fn(),
    clearUserWatchingUpdateConfigField: jest.fn(),
    clearUserWatchingUpdateConfig: jest.fn(),
  },
}));

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { userWatchingUpdateConfigService } from '@/lib/user-watching-update-config-service';
import { DELETE, GET, PATCH } from './route';

const getRole = getAdminRoleFromRequest as jest.Mock;
const loadConfig = getConfig as jest.Mock;
const saveAdminConfig = db.saveAdminConfig as jest.Mock;
const getUserConfigOverride =
  userWatchingUpdateConfigService.getUserWatchingUpdateConfig as jest.Mock;
const updateUserConfigOverride =
  userWatchingUpdateConfigService.updateUserWatchingUpdateConfig as jest.Mock;
const clearField =
  userWatchingUpdateConfigService.clearUserWatchingUpdateConfigField as jest.Mock;
const clearAll =
  userWatchingUpdateConfigService.clearUserWatchingUpdateConfig as jest.Mock;
const reconcileUser = updateCheckRuntime.reconcileUser as jest.Mock;
const previousStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

const systemConfig = {
  updateCheckBackendEnabled: true,
  updateCheckSchedulerEnabled: true,
  updateCheckCronExpression: '*/30 * * * *',
  updateCheckTimezone: 'UTC',
  updateCheckLogRetentionCount: 200,
  updateCheckBatchSize: 100,
  updateCheckMaxUsers: 1000,
  updateCheckMaxFollowPerUser: 100,
};

function adminConfig(): AdminConfig {
  return {
    SystemConfig: systemConfig,
    UserConfig: {
      Users: [
        { username: 'owner', role: 'owner' },
        { username: 'admin-a', role: 'admin' },
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
          allowCustomSchedule: false,
          updateCheckPermissionUpdatedAt: 1000,
          updateCheckPermissionOperator: 'owner',
        },
        { username: 'legacy', role: 'user' },
      ],
    },
  } as AdminConfig;
}

describe('user watching update config Management API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    getRole.mockResolvedValue('owner');
    loadConfig.mockImplementation(async () => adminConfig());
    saveAdminConfig.mockResolvedValue(undefined);
    updateUserConfigOverride.mockResolvedValue({
      cronExpression: '0 * * * *',
      timezone: 'Europe/Berlin',
    });
    clearAll.mockResolvedValue(undefined);
    reconcileUser.mockResolvedValue(undefined);
    getUserConfigOverride.mockResolvedValue({
      cronExpression: '0 * * * *',
      timezone: 'Europe/Berlin',
    });
  });

  afterAll(() => {
    if (previousStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = previousStorageType;
    }
  });

  it('allows an owner to get an ordinary user config', async () => {
    const response = await getUserConfig('alice');

    expect(response.status).toBe(200);
    expect(reconcileUser).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      username: 'alice',
      permission: {
        enabled: true,
        allowCustomSchedule: false,
      },
      userConfig: {
        cronExpression: '0 * * * *',
        timezone: 'Europe/Berlin',
      },
      effective: {
        enabled: true,
        cronExpression: '0 * * * *',
        timezone: 'Europe/Berlin',
      },
      sources: {
        cron: 'user',
        timezone: 'user',
      },
      triggerLinkAccessControl: {
        enabled: true,
        ipLimit: {
          enabled: true,
          windowMinutes: 60,
          maxAttempts: 5,
          blockMinutes: 30,
        },
        userLimit: {
          enabled: true,
          windowMinutes: 1440,
          maxAttempts: 20,
        },
        autoDisable: {
          enabled: true,
          violationThreshold: 3,
          violationWindowMinutes: 60,
        },
      },
      audit: {
        updatedAt: 1000,
        operator: 'owner',
      },
    });
  });

  it('returns inherited values and default ability permissions for legacy users', async () => {
    getUserConfigOverride.mockResolvedValue(null);

    const response = await getUserConfig('legacy');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      username: 'legacy',
      permission: {
        enabled: false,
        allowCustomSchedule: true,
      },
      userConfig: null,
      effective: {
        enabled: false,
        cronExpression: '*/30 * * * *',
        timezone: 'UTC',
      },
      sources: {
        cron: 'system',
        timezone: 'system',
      },
    });
  });

  it('allows an admin to get an ordinary user config', async () => {
    getRole.mockResolvedValue('admin');

    const response = await getUserConfig('alice');

    expect(response.status).toBe(200);
    expect(getUserConfigOverride).toHaveBeenCalledWith('alice');
  });

  it('allows an admin to update an ordinary user config', async () => {
    getRole.mockResolvedValue('admin');
    updateUserConfigOverride.mockResolvedValue({ timezone: 'Asia/Tokyo' });
    getUserConfigOverride.mockResolvedValue({ timezone: 'Asia/Tokyo' });

    const response = await patchUserConfig('alice', {
      timezone: 'Asia/Tokyo',
    });

    expect(response.status).toBe(200);
    expect(updateUserConfigOverride).toHaveBeenCalledWith('alice', {
      timezone: 'Asia/Tokyo',
    });
  });

  it('forbids an admin from getting another admin config', async () => {
    getRole.mockResolvedValue('admin');

    const response = await getUserConfig('admin-a');

    expect(response.status).toBe(403);
    expect(getUserConfigOverride).not.toHaveBeenCalled();
  });

  it('forbids an admin from updating another admin config', async () => {
    getRole.mockResolvedValue('admin');

    const response = await patchUserConfig('admin-a', {
      allowCustomSchedule: false,
    });

    expect(response.status).toBe(403);
    expect(saveAdminConfig).not.toHaveBeenCalled();
    expect(updateUserConfigOverride).not.toHaveBeenCalled();
  });

  it('forbids a non-admin user', async () => {
    getRole.mockResolvedValue(null);

    const response = await getUserConfig('alice');

    expect(response.status).toBe(403);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it('saves custom schedule permission without reconciling schedules', async () => {
    getUserConfigOverride.mockResolvedValue(null);

    const response = await patchUserConfig('alice', {
      allowCustomSchedule: true,
    });

    expect(response.status).toBe(200);
    expect(saveAdminConfig).toHaveBeenCalledTimes(1);
    const saved = saveAdminConfig.mock.calls[0][0] as AdminConfig;
    const alice = saved.UserConfig.Users.find(
      (user) => user.username === 'alice',
    );
    expect(alice).toMatchObject({
      allowCustomSchedule: true,
      updateCheckPermissionUpdatedAt: expect.any(Number),
      updateCheckPermissionOperator: 'owner',
    });
    expect(updateUserConfigOverride).not.toHaveBeenCalled();
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('saves a valid cron expression through the service and reconciles', async () => {
    updateUserConfigOverride.mockResolvedValue({
      cronExpression: '0 */6 * * *',
    });
    getUserConfigOverride.mockResolvedValue({ cronExpression: '0 */6 * * *' });

    const response = await patchUserConfig('alice', {
      cronExpression: '0 */6 * * *',
    });

    expect(response.status).toBe(200);
    expect(updateUserConfigOverride).toHaveBeenCalledWith('alice', {
      cronExpression: '0 */6 * * *',
    });
    expect(reconcileUser).toHaveBeenCalledWith('alice');
  });

  it('saves a valid timezone through the service and reconciles', async () => {
    updateUserConfigOverride.mockResolvedValue({ timezone: 'Asia/Shanghai' });
    getUserConfigOverride.mockResolvedValue({ timezone: 'Asia/Shanghai' });

    const response = await patchUserConfig('alice', {
      timezone: 'Asia/Shanghai',
    });

    expect(response.status).toBe(200);
    expect(updateUserConfigOverride).toHaveBeenCalledWith('alice', {
      timezone: 'Asia/Shanghai',
    });
    expect(reconcileUser).toHaveBeenCalledWith('alice');
  });

  it('saves trigger link access-control settings through the service', async () => {
    const triggerLinkAccessControl = {
      enabled: true,
      ipLimit: {
        enabled: true,
        windowMinutes: 30,
        maxAttempts: 3,
        blockMinutes: 10,
      },
      userLimit: {
        enabled: true,
        windowMinutes: 60,
        maxAttempts: 8,
      },
      autoDisable: {
        enabled: true,
        violationThreshold: 2,
        violationWindowMinutes: 30,
      },
    };

    const response = await patchUserConfig('alice', {
      triggerLinkAccessControl,
    });

    expect(response.status).toBe(200);
    expect(updateUserConfigOverride).toHaveBeenCalledWith('alice', {
      triggerLinkAccessControl,
    });
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('returns 400 when the service rejects an invalid cron expression', async () => {
    updateUserConfigOverride.mockRejectedValue(
      new Error('INVALID_CRON_EXPRESSION'),
    );

    const response = await patchUserConfig('alice', {
      cronExpression: 'invalid',
    });

    expect(response.status).toBe(400);
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('returns 400 when the service rejects an invalid timezone', async () => {
    updateUserConfigOverride.mockRejectedValue(new Error('INVALID_TIMEZONE'));

    const response = await patchUserConfig('alice', {
      timezone: 'invalid/timezone',
    });

    expect(response.status).toBe(400);
  });

  it('rejects logRetentionCount updates at the route schema', async () => {
    const response = await patchUserConfig('alice', {
      logRetentionCount: 500,
    });

    expect(response.status).toBe(400);
    expect(updateUserConfigOverride).not.toHaveBeenCalled();
    expect(saveAdminConfig).not.toHaveBeenCalled();
  });

  it('returns the merged userConfig from a partial update', async () => {
    getUserConfigOverride.mockResolvedValue({
      cronExpression: '0 * * * *',
      timezone: 'Asia/Tokyo',
    });

    const response = await patchUserConfig('alice', {
      timezone: 'Asia/Tokyo',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      userConfig: {
        cronExpression: '0 * * * *',
        timezone: 'Asia/Tokyo',
      },
    });
  });

  it('deletes all overrides when no field is provided', async () => {
    clearAll.mockResolvedValue(undefined);

    const response = await deleteUserConfig('alice');

    expect(response.status).toBe(200);
    expect(clearAll).toHaveBeenCalledWith('alice');
    expect(clearField).not.toHaveBeenCalled();
    expect(reconcileUser).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toMatchObject({ userConfig: null });
  });

  it('deletes one override field', async () => {
    clearField.mockResolvedValue({ timezone: 'Europe/Berlin' });

    const response = await deleteUserConfig('alice', {
      field: 'cronExpression',
    });

    expect(response.status).toBe(200);
    expect(clearField).toHaveBeenCalledWith('alice', 'cronExpression');
    expect(reconcileUser).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toMatchObject({
      userConfig: { timezone: 'Europe/Berlin' },
    });
  });

  it('rejects deleting logRetentionCount override', async () => {
    const response = await deleteUserConfig('alice', {
      field: 'logRetentionCount',
    });

    expect(response.status).toBe(400);
    expect(clearField).not.toHaveBeenCalled();
  });

  it('returns 404 when the target user does not exist', async () => {
    const response = await deleteUserConfig('missing');

    expect(response.status).toBe(404);
    expect(clearAll).not.toHaveBeenCalled();
  });
});

function context(username: string) {
  return { params: Promise.resolve({ username }) };
}

function request(username: string, method: string, body?: unknown) {
  return new NextRequest(
    `http://localhost/api/admin/watching-updates/users/${encodeURIComponent(username)}/config`,
    {
      method,
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function getUserConfig(username: string) {
  return GET(request(username, 'GET'), context(username));
}

function patchUserConfig(username: string, body: unknown) {
  return PATCH(request(username, 'PATCH', body), context(username));
}

function deleteUserConfig(username: string, body?: unknown) {
  return DELETE(request(username, 'DELETE', body), context(username));
}
