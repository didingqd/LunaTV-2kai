/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(() => ({ username: 'owner' })),
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

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { updateCheckPermissionService } from '@/lib/update-check-permission-service';
import { POST } from './route';

const loadConfig = getConfig as jest.Mock;
const saveAdminConfig = db.saveAdminConfig as jest.Mock;
const onSystemConfigChanged =
  updateCheckPermissionService.onSystemConfigChanged as jest.Mock;
const handleSystemConfigChanged =
  updateCheckRuntime.handleSystemConfigChanged as jest.Mock;
const previousStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;
const previousOwner = process.env.USERNAME;

describe('admin config Watching Updates lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
  });

  afterAll(() => {
    restoreEnvironment('NEXT_PUBLIC_STORAGE_TYPE', previousStorageType);
    restoreEnvironment('USERNAME', previousOwner);
  });

  it('normalizes SystemConfig and applies the switch immediately', async () => {
    const previous = config(false);
    const current = config(true);
    loadConfig.mockResolvedValue(previous);

    const response = await POST(
      new NextRequest('http://localhost/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.Config.SystemConfig.updateCheckBackendEnabled).toBe(true);
    expect(saveAdminConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        SystemConfig: expect.objectContaining({
          updateCheckBackendEnabled: true,
        }),
      }),
    );
    expect(onSystemConfigChanged).toHaveBeenCalledWith(true);
    expect(handleSystemConfigChanged).toHaveBeenCalledWith(
      previous.SystemConfig,
      expect.objectContaining({ updateCheckBackendEnabled: true }),
    );
  });

  it('passes scheduler config changes to the runtime', async () => {
    const previous = config(true);
    const current = config(true);
    current.SystemConfig!.updateCheckCronExpression = '0 */6 * * *';
    current.SystemConfig!.updateCheckTimezone = 'Asia/Shanghai';
    current.SystemConfig!.updateCheckSchedulerEnabled = false;
    loadConfig.mockResolvedValue(previous);

    const response = await POST(
      new NextRequest('http://localhost/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      }),
    );

    expect(response.status).toBe(200);
    expect(handleSystemConfigChanged).toHaveBeenCalledWith(
      previous.SystemConfig,
      expect.objectContaining({
        updateCheckCronExpression: '0 */6 * * *',
        updateCheckTimezone: 'Asia/Shanghai',
        updateCheckSchedulerEnabled: false,
      }),
    );
  });
});

function config(enabled: boolean): AdminConfig {
  return {
    SystemConfig: {
      updateCheckBackendEnabled: enabled,
      updateCheckSchedulerEnabled: true,
      updateCheckCronInterval: 30 * 60 * 1000,
      updateCheckCronExpression: '*/30 * * * *',
      updateCheckTimezone: 'UTC',
      updateCheckLogRetentionCount: 200,
      updateCheckBatchSize: 100,
      updateCheckMaxUsers: 1000,
      updateCheckMaxFollowPerUser: 100,
    },
    UserConfig: { Users: [{ username: 'owner', role: 'owner' }] },
  } as AdminConfig;
}

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
