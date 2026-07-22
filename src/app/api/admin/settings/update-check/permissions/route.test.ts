/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/admin-auth', () => ({
  getAdminRoleFromRequest: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));
jest.mock('@/lib/update-check-permission-service', () => ({
  updateCheckPermissionService: { setPermission: jest.fn() },
}));

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { updateCheckPermissionService } from '@/lib/update-check-permission-service';
import { PUT } from './route';

const getRole = getAdminRoleFromRequest as jest.Mock;
const getAuth = getAuthInfoFromCookie as jest.Mock;
const loadConfig = getConfig as jest.Mock;
const setPermission = updateCheckPermissionService.setPermission as jest.Mock;
const previousStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

describe('update check user permission route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    getRole.mockResolvedValue('admin');
    getAuth.mockReturnValue({ username: 'admin' });
    loadConfig.mockResolvedValue({
      UserConfig: {
        Users: [
          { username: 'owner', role: 'owner' },
          { username: 'alice', role: 'user' },
        ],
      },
    });
  });

  afterAll(() => {
    if (previousStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = previousStorageType;
    }
  });

  it('allows an authenticated admin to update an existing user', async () => {
    setPermission.mockResolvedValue({
      userId: 'alice',
      enabled: true,
      createdAt: 100,
      updatedAt: 100,
      operator: 'admin',
    });

    const response = await updatePermission('alice', true);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      permission: { userId: 'alice', enabled: true },
    });
    expect(setPermission).toHaveBeenCalledWith('alice', true, 'admin');
  });

  it('does not create authorization for an unknown user', async () => {
    const response = await updatePermission('missing', true);

    expect(response.status).toBe(404);
    expect(setPermission).not.toHaveBeenCalled();
  });

  it('keeps owner authorization implicit', async () => {
    setPermission.mockRejectedValue(new Error('OWNER_PERMISSION_IMPLICIT'));

    const response = await updatePermission('owner', false);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Owner permission follows the system switch',
    });
  });
});

function updatePermission(userId: string, enabled: boolean) {
  return PUT(
    new NextRequest(
      'http://localhost/api/admin/settings/update-check/permissions',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, enabled }),
      },
    ),
  );
}
