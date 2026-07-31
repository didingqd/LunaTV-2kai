/** @jest-environment node */

import { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
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
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { userWatchingUpdateConfigService } from '@/lib/user-watching-update-config-service';
import { DELETE, GET, PATCH } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const loadConfig = getConfig as jest.Mock;
const clearCache = clearConfigCache as jest.Mock;
const reconcileUser = updateCheckRuntime.reconcileUser as jest.Mock;
const getUserConfig =
  userWatchingUpdateConfigService.getUserWatchingUpdateConfig as jest.Mock;
const updateUserConfig =
  userWatchingUpdateConfigService.updateUserWatchingUpdateConfig as jest.Mock;
const clearUserConfigField =
  userWatchingUpdateConfigService.clearUserWatchingUpdateConfigField as jest.Mock;

const previousOwner = process.env.USERNAME;

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

describe('user watching update config API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.USERNAME = 'owner';
    getAuth.mockReturnValue({ username: 'alice' });
    loadConfig.mockImplementation(async () => adminConfig());
    getUserConfig.mockResolvedValue({
      cronExpression: '0 * * * *',
      timezone: 'Europe/Berlin',
    });
    updateUserConfig.mockResolvedValue({
      cronExpression: '0 * * * *',
      timezone: 'Europe/Berlin',
    });
    clearUserConfigField.mockResolvedValue(null);
    reconcileUser.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (previousOwner === undefined) {
      delete process.env.USERNAME;
    } else {
      process.env.USERNAME = previousOwner;
    }
  });

  it('returns 401 when the user is not signed in', async () => {
    getAuth.mockReturnValue(null);

    const response = await GET(request('GET'));

    expect(response.status).toBe(401);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it('returns the signed-in user config', async () => {
    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expect(getUserConfig).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toEqual({
      permission: {
        enabled: true,
        allowCustomSchedule: true,
        allowTriggerLink: false,
      },
      userConfig: {
        cronExpression: '0 * * * *',
        timezone: 'Europe/Berlin',
      },
      effectiveConfig: {
        enabled: true,
        cronExpression: '0 * * * *',
        timezone: 'Europe/Berlin',
      },
      sources: {
        cron: 'user',
        timezone: 'user',
      },
    });
  });

  it('ignores requested usernames and only reads the signed-in user', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/user/watching-updates/config?username=bob',
      ),
    );

    expect(response.status).toBe(200);
    expect(getUserConfig).toHaveBeenCalledWith('alice');
    expect(getUserConfig).not.toHaveBeenCalledWith('bob');
  });

  it('saves cron when custom schedule is allowed', async () => {
    updateUserConfig.mockResolvedValue({ cronExpression: '0 */6 * * *' });
    getUserConfig.mockResolvedValue({ cronExpression: '0 */6 * * *' });

    const response = await PATCH(
      request('PATCH', { cronExpression: '0 */6 * * *' }),
    );

    expect(response.status).toBe(200);
    expect(updateUserConfig).toHaveBeenCalledWith('alice', {
      cronExpression: '0 */6 * * *',
    });
    expect(clearCache).toHaveBeenCalled();
    expect(reconcileUser).toHaveBeenCalledWith('alice');
  });

  it('returns 403 when custom schedule is disabled', async () => {
    loadConfig.mockImplementation(async () =>
      adminConfig({ allowCustomSchedule: false }),
    );

    const response = await PATCH(
      request('PATCH', { cronExpression: '0 */6 * * *' }),
    );

    expect(response.status).toBe(403);
    expect(updateUserConfig).not.toHaveBeenCalled();
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('saves timezone when custom schedule is allowed', async () => {
    updateUserConfig.mockResolvedValue({ timezone: 'Asia/Tokyo' });
    getUserConfig.mockResolvedValue({ timezone: 'Asia/Tokyo' });

    const response = await PATCH(request('PATCH', { timezone: 'Asia/Tokyo' }));

    expect(response.status).toBe(200);
    expect(updateUserConfig).toHaveBeenCalledWith('alice', {
      timezone: 'Asia/Tokyo',
    });
    expect(reconcileUser).toHaveBeenCalledWith('alice');
  });

  it('returns 400 for an invalid cron expression', async () => {
    updateUserConfig.mockRejectedValue(new Error('INVALID_CRON_EXPRESSION'));

    const response = await PATCH(
      request('PATCH', { cronExpression: 'invalid' }),
    );

    expect(response.status).toBe(400);
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid timezone', async () => {
    updateUserConfig.mockRejectedValue(new Error('INVALID_TIMEZONE'));

    const response = await PATCH(
      request('PATCH', { timezone: 'invalid/timezone' }),
    );

    expect(response.status).toBe(400);
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('rejects forbidden patch fields', async () => {
    const response = await PATCH(
      request('PATCH', {
        username: 'bob',
        allowCustomSchedule: true,
        logRetentionCount: 500,
      }),
    );

    expect(response.status).toBe(400);
    expect(updateUserConfig).not.toHaveBeenCalled();
  });

  it('deletes a cron override', async () => {
    getUserConfig.mockResolvedValue({ timezone: 'Europe/Berlin' });

    const response = await DELETE(
      request('DELETE', { field: 'cronExpression' }),
    );

    expect(response.status).toBe(200);
    expect(clearUserConfigField).toHaveBeenCalledWith(
      'alice',
      'cronExpression',
    );
    expect(reconcileUser).toHaveBeenCalledWith('alice');
  });

  it('deletes a timezone override', async () => {
    getUserConfig.mockResolvedValue({ cronExpression: '0 * * * *' });

    const response = await DELETE(request('DELETE', { field: 'timezone' }));

    expect(response.status).toBe(200);
    expect(clearUserConfigField).toHaveBeenCalledWith('alice', 'timezone');
    expect(reconcileUser).toHaveBeenCalledWith('alice');
  });

  it('deletes cron and timezone overrides without deleting triggerLink', async () => {
    getUserConfig.mockResolvedValue({
      triggerLink: { enabled: true, tokenId: 'token-1' },
    });

    const response = await DELETE(request('DELETE', {}));

    expect(response.status).toBe(200);
    expect(clearUserConfigField).toHaveBeenNthCalledWith(
      1,
      'alice',
      'cronExpression',
    );
    expect(clearUserConfigField).toHaveBeenNthCalledWith(
      2,
      'alice',
      'timezone',
    );
    expect(reconcileUser).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toMatchObject({
      userConfig: {
        triggerLink: { enabled: true, tokenId: 'token-1' },
      },
    });
  });
});

function adminConfig(
  alice?: Partial<AdminConfig['UserConfig']['Users'][number]>,
): AdminConfig {
  return {
    SystemConfig: systemConfig,
    UserConfig: {
      Users: [
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
          allowCustomSchedule: true,
          allowTriggerLink: false,
          ...alice,
        },
        {
          username: 'bob',
          role: 'user',
          updateCheckBackendEnabled: true,
        },
      ],
    },
  } as AdminConfig;
}

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/user/watching-updates/config', {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
