/** @jest-environment node */

import { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';

jest.mock('@/lib/admin-auth', () => ({
  getAdminRoleFromRequest: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  clearConfigCache: jest.fn(),
  getConfig: jest.fn(),
}));
jest.mock('@/lib/trigger-token-service', () => ({
  triggerTokenService: {
    getStatus: jest.fn(),
    setEnabled: jest.fn(),
    setToken: jest.fn(),
    createToken: jest.fn(),
    revealToken: jest.fn(),
  },
}));
jest.mock('@/lib/trigger-link-access-control-service', () => ({
  triggerLinkAccessControlService: {
    clearUserState: jest.fn(),
  },
}));

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { triggerLinkAccessControlService } from '@/lib/trigger-link-access-control-service';
import { triggerTokenService } from '@/lib/trigger-token-service';
import { GET, PATCH, PUT } from './route';

const getRole = getAdminRoleFromRequest as jest.Mock;
const getAuth = getAuthInfoFromCookie as jest.Mock;
const loadConfig = getConfig as jest.Mock;
const clearCache = clearConfigCache as jest.Mock;
const getStatus = triggerTokenService.getStatus as jest.Mock;
const setEnabled = triggerTokenService.setEnabled as jest.Mock;
const setToken = triggerTokenService.setToken as jest.Mock;
const createToken = triggerTokenService.createToken as jest.Mock;
const revealToken = triggerTokenService.revealToken as jest.Mock;
const clearUserState =
  triggerLinkAccessControlService.clearUserState as jest.Mock;

const status = {
  enabled: true,
  createdAt: 1000,
  rotatedAt: 1000,
  expiresAt: null,
  hasToken: true,
  expired: false,
  tokenId: 'token-1',
  maskedToken: 'toke****cret',
  canRevealToken: true,
};

describe('admin watching updates trigger link API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getRole.mockResolvedValue('owner');
    getAuth.mockReturnValue({ username: 'owner' });
    loadConfig.mockResolvedValue(adminConfig());
    getStatus.mockResolvedValue(status);
    setEnabled.mockResolvedValue({ ...status, enabled: false });
    setToken.mockResolvedValue({ ...status, plainToken: 'manual-secret' });
    createToken.mockResolvedValue({ ...status, plainToken: 'token.secret' });
    revealToken.mockResolvedValue({ ...status, plainToken: 'token.secret' });
  });

  it('returns masked token status without secrets', async () => {
    const response = await GET(request('alice', 'GET'), context('alice'));

    expect(response.status).toBe(200);
    expect(getStatus).toHaveBeenCalledWith('alice');
    const body = await response.json();
    expect(body).toMatchObject({
      username: 'alice',
      permission: { allowTriggerLink: true },
      triggerLink: {
        maskedToken: 'toke****cret',
        triggerLink:
          'http://localhost/api/update-check-trigger?token=toke****cret',
      },
    });
    expect(JSON.stringify(body)).not.toContain('token.secret');
  });

  it('updates enabled state immediately through the token service', async () => {
    const response = await PATCH(
      request('alice', 'PATCH', { enabled: false }),
      context('alice'),
    );

    expect(response.status).toBe(200);
    expect(setEnabled).toHaveBeenCalledWith('alice', false);
    expect(clearCache).toHaveBeenCalled();
  });

  it('clears violation state when an admin re-enables a trigger link', async () => {
    setEnabled.mockResolvedValue({ ...status, enabled: true });

    const response = await PATCH(
      request('alice', 'PATCH', { enabled: true }),
      context('alice'),
    );

    expect(response.status).toBe(200);
    expect(setEnabled).toHaveBeenCalledWith('alice', true);
    expect(clearUserState).toHaveBeenCalledWith('alice');
  });

  it('sets a manual token without returning the plain token by default', async () => {
    const response = await PATCH(
      request('alice', 'PATCH', { token: 'manual-secret' }),
      context('alice'),
    );

    expect(response.status).toBe(200);
    expect(setToken).toHaveBeenCalledWith('alice', 'manual-secret', {
      enabled: undefined,
    });
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('manual-secret');
  });

  it('generates a new token using the existing generation logic', async () => {
    const response = await PATCH(
      request('alice', 'PATCH', { action: 'generate' }),
      context('alice'),
    );

    expect(response.status).toBe(200);
    expect(createToken).toHaveBeenCalledWith('alice');
  });

  it('reveals the full token only through the reveal operation', async () => {
    const response = await PUT(
      request('alice', 'PUT', { action: 'reveal' }),
      context('alice'),
    );

    expect(response.status).toBe(200);
    expect(revealToken).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toMatchObject({
      triggerLink: {
        fullToken: 'token.secret',
        fullTriggerLink:
          'http://localhost/api/update-check-trigger?token=token.secret',
      },
    });
  });

  it('forbids an admin from managing another admin token', async () => {
    getRole.mockResolvedValue('admin');

    const response = await GET(request('admin-a', 'GET'), context('admin-a'));

    expect(response.status).toBe(403);
    expect(getStatus).not.toHaveBeenCalled();
  });
});

function adminConfig(): AdminConfig {
  return {
    UserConfig: {
      Users: [
        { username: 'owner', role: 'owner' },
        { username: 'admin-a', role: 'admin' },
        { username: 'alice', role: 'user', allowTriggerLink: true },
      ],
    },
  } as AdminConfig;
}

function context(username: string) {
  return { params: Promise.resolve({ username }) };
}

function request(username: string, method: string, body?: unknown) {
  return new NextRequest(
    `http://localhost/api/admin/watching-updates/users/${encodeURIComponent(username)}/trigger-link`,
    {
      method,
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}
