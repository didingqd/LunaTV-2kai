/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/app/api/watching-follows/route-utils', () => ({
  noStoreJson: jest.requireActual('@/app/api/watching-follows/route-utils')
    .noStoreJson,
  requireWatchingFollowUser: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  clearConfigCache: jest.fn(),
  getConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: { saveAdminConfig: jest.fn() },
}));

import type { AdminConfig } from '@/lib/admin.types';
import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { requireWatchingFollowUser } from '@/app/api/watching-follows/route-utils';
import { GET, PUT } from './route';

const requireUser = requireWatchingFollowUser as jest.Mock;
const loadConfig = getConfig as jest.Mock;
const saveAdminConfig = db.saveAdminConfig as jest.Mock;
const clearCache = clearConfigCache as jest.Mock;

describe('watch completion threshold user route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERNAME = 'owner';
    requireUser.mockResolvedValue({ username: 'alice' });
    loadConfig.mockResolvedValue(config());
  });

  it('returns the default threshold for users without a preference', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/user/watch-completion-threshold'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      watchCompletionThreshold: 80,
    });
  });

  it('saves a sanitized user threshold', async () => {
    const adminConfig = config();
    loadConfig.mockResolvedValue(adminConfig);

    const response = await PUT(
      new NextRequest('http://localhost/api/user/watch-completion-threshold', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchCompletionThreshold: 50 }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      watchCompletionThreshold: 50,
    });
    expect(adminConfig.UserConfig.Users[0].watchCompletionThreshold).toBe(50);
    expect(saveAdminConfig).toHaveBeenCalledWith(adminConfig);
    expect(clearCache).toHaveBeenCalled();
  });

  it('falls back to 80 for invalid updates', async () => {
    const adminConfig = config();
    loadConfig.mockResolvedValue(adminConfig);

    const response = await PUT(
      new NextRequest('http://localhost/api/user/watch-completion-threshold', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchCompletionThreshold: 'bad' }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      watchCompletionThreshold: 80,
    });
    expect(adminConfig.UserConfig.Users[0].watchCompletionThreshold).toBe(80);
  });
});

function config(): AdminConfig {
  return {
    UserConfig: {
      Users: [{ username: 'alice', role: 'user' }],
    },
  } as AdminConfig;
}
