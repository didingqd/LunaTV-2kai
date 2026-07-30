/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/admin-auth', () => ({
  getAdminRoleFromRequest: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  clearConfigCache: jest.fn(),
  getConfig: jest.fn(),
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
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { userWatchingUpdateConfigService } from '@/lib/user-watching-update-config-service';
import { DELETE, GET, PATCH } from './route';

const getRole = getAdminRoleFromRequest as jest.Mock;
const loadConfig = getConfig as jest.Mock;
const getOverride =
  userWatchingUpdateConfigService.getUserWatchingUpdateConfig as jest.Mock;
const updateOverride =
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
  updateCheckCronInterval: 30 * 60 * 1000,
  updateCheckCronExpression: '*/30 * * * *',
  updateCheckTimezone: 'UTC',
  updateCheckLogRetentionCount: 200,
  updateCheckBatchSize: 100,
  updateCheckMaxUsers: 1000,
  updateCheckMaxFollowPerUser: 100,
};

describe('user watching update config Management API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    getRole.mockResolvedValue('owner');
    loadConfig.mockResolvedValue({
      SystemConfig: systemConfig,
      UserConfig: {
        Users: [
          { username: 'owner', role: 'owner' },
          { username: 'admin-a', role: 'admin' },
          {
            username: 'alice',
            role: 'user',
            updateCheckBackendEnabled: true,
          },
          { username: 'legacy', role: 'user' },
        ],
      },
    });
    getOverride.mockResolvedValue({
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
      permission: true,
      override: {
        cronExpression: '0 * * * *',
        timezone: 'Europe/Berlin',
      },
      effective: {
        enabled: true,
        cronExpression: '0 * * * *',
        timezone: 'Europe/Berlin',
        logRetentionCount: 200,
      },
      sources: {
        cron: 'user',
        timezone: 'user',
        retention: 'system',
      },
    });
  });

  it('returns inherited values for a user without an override', async () => {
    getOverride.mockResolvedValue(null);

    const response = await getUserConfig('legacy');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      username: 'legacy',
      permission: false,
      override: null,
      effective: {
        enabled: false,
        cronExpression: '*/30 * * * *',
        timezone: 'UTC',
        logRetentionCount: 200,
      },
      sources: {
        cron: 'system',
        timezone: 'system',
        retention: 'system',
      },
    });
  });

  it('allows an admin to get an ordinary user config', async () => {
    getRole.mockResolvedValue('admin');

    const response = await getUserConfig('alice');

    expect(response.status).toBe(200);
    expect(getOverride).toHaveBeenCalledWith('alice');
  });

  it('forbids an admin from getting another admin config', async () => {
    getRole.mockResolvedValue('admin');

    const response = await getUserConfig('admin-a');

    expect(response.status).toBe(403);
    expect(getOverride).not.toHaveBeenCalled();
  });

  it('forbids a non-admin user', async () => {
    getRole.mockResolvedValue(null);

    const response = await getUserConfig('alice');

    expect(response.status).toBe(403);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it('saves a valid cron expression through the service', async () => {
    updateOverride.mockResolvedValue({ cronExpression: '0 */6 * * *' });

    const response = await patchUserConfig('alice', {
      cronExpression: '0 */6 * * *',
    });

    expect(response.status).toBe(200);
    expect(updateOverride).toHaveBeenCalledWith('alice', {
      cronExpression: '0 */6 * * *',
    });
    expect(reconcileUser).toHaveBeenCalledWith('alice');
  });

  it('returns 400 when the service rejects an invalid cron expression', async () => {
    updateOverride.mockRejectedValue(new Error('INVALID_CRON_EXPRESSION'));

    const response = await patchUserConfig('alice', {
      cronExpression: 'invalid',
    });

    expect(response.status).toBe(400);
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('saves a valid timezone through the service', async () => {
    updateOverride.mockResolvedValue({ timezone: 'Asia/Shanghai' });

    const response = await patchUserConfig('alice', {
      timezone: 'Asia/Shanghai',
    });

    expect(response.status).toBe(200);
    expect(updateOverride).toHaveBeenCalledWith('alice', {
      timezone: 'Asia/Shanghai',
    });
    expect(reconcileUser).toHaveBeenCalledWith('alice');
  });

  it('returns 400 when the service rejects an invalid timezone', async () => {
    updateOverride.mockRejectedValue(new Error('INVALID_TIMEZONE'));

    const response = await patchUserConfig('alice', {
      timezone: 'invalid/timezone',
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 for an out-of-range retention count', async () => {
    updateOverride.mockRejectedValue(new Error('INVALID_LOG_RETENTION_COUNT'));

    const response = await patchUserConfig('alice', {
      logRetentionCount: 5001,
    });

    expect(response.status).toBe(400);
  });

  it('returns the merged override from a partial update', async () => {
    updateOverride.mockResolvedValue({
      cronExpression: '0 * * * *',
      timezone: 'Asia/Tokyo',
    });

    const response = await patchUserConfig('alice', {
      timezone: 'Asia/Tokyo',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      override: {
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
    await expect(response.json()).resolves.toMatchObject({ override: null });
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
      override: { timezone: 'Europe/Berlin' },
    });
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
