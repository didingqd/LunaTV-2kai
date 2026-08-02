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
jest.mock('@/lib/trigger-token-service', () => ({
  triggerTokenService: {
    getStatus: jest.fn(),
    createToken: jest.fn(),
    rotateToken: jest.fn(),
    setEnabled: jest.fn(),
    setUserEnabled: jest.fn(),
    setExpiresAt: jest.fn(),
    expireToken: jest.fn(),
    revealToken: jest.fn(),
    deleteToken: jest.fn(),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { triggerTokenService } from '@/lib/trigger-token-service';
import { DELETE, GET, PATCH, POST, PUT } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const loadConfig = getConfig as jest.Mock;
const clearCache = clearConfigCache as jest.Mock;
const getStatus = triggerTokenService.getStatus as jest.Mock;
const createToken = triggerTokenService.createToken as jest.Mock;
const rotateToken = triggerTokenService.rotateToken as jest.Mock;
const setEnabled = triggerTokenService.setEnabled as jest.Mock;
const setUserEnabled = triggerTokenService.setUserEnabled as jest.Mock;
const setExpiresAt = triggerTokenService.setExpiresAt as jest.Mock;
const expireToken = triggerTokenService.expireToken as jest.Mock;
const revealToken = triggerTokenService.revealToken as jest.Mock;
const deleteToken = triggerTokenService.deleteToken as jest.Mock;

const status = {
  enabled: true,
  userTriggerEnabled: true,
  adminTriggerEnabled: true,
  effectiveEnabled: true,
  disabledReason: null,
  disabledAt: null,
  disabledSource: null,
  createdAt: 1000,
  rotatedAt: 1000,
  expiresAt: null,
  hasToken: true,
  expired: false,
  tokenId: 'token-1',
  maskedToken: 'toke****cret',
  canRevealToken: true,
};

describe('user watching updates trigger link API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getAuth.mockReturnValue({ username: 'alice' });
    loadConfig.mockResolvedValue(adminConfig());
    getStatus.mockResolvedValue(status);
    createToken.mockResolvedValue({ ...status, plainToken: 'token.secret' });
    rotateToken.mockResolvedValue({
      ...status,
      plainToken: 'token.new-secret',
    });
    revealToken.mockResolvedValue({ ...status, plainToken: 'token.secret' });
    setEnabled.mockResolvedValue({ ...status, enabled: false });
    setUserEnabled.mockResolvedValue({ ...status, enabled: false });
    setExpiresAt.mockResolvedValue({ ...status, expiresAt: 5000 });
    expireToken.mockResolvedValue({
      ...status,
      expiresAt: 2000,
      expired: true,
    });
    deleteToken.mockResolvedValue({
      enabled: false,
      createdAt: null,
      rotatedAt: null,
      expiresAt: null,
      hasToken: false,
      expired: false,
    });
  });

  it('returns 401 when the user is not signed in', async () => {
    getAuth.mockReturnValue(null);

    const response = await GET(request('GET'));

    expect(response.status).toBe(401);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it('returns 404 when the signed-in user does not exist', async () => {
    loadConfig.mockResolvedValue(adminConfig(undefined, []));

    const response = await GET(request('GET'));

    expect(response.status).toBe(404);
  });

  it('gets trigger link status without returning secrets', async () => {
    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expect(getStatus).toHaveBeenCalledWith('alice');
    const body = await response.json();
    expect(body).toMatchObject({
      enabled: true,
      hasToken: true,
      tokenConfigured: true,
      maskedToken: 'toke****cret',
      triggerLink:
        'http://localhost/api/update-check-trigger?token=toke****cret',
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('hash');
  });

  it('keeps the current user token visible when the effective status is disabled', async () => {
    getStatus.mockResolvedValue({
      ...status,
      enabled: false,
      userTriggerEnabled: false,
      effectiveEnabled: false,
    });

    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: false,
      userTriggerEnabled: false,
      effectiveEnabled: false,
      hasToken: true,
      maskedToken: 'toke****cret',
      triggerLink:
        'http://localhost/api/update-check-trigger?token=toke****cret',
      canRevealToken: true,
    });
  });

  it('uses forwarded origin when the request URL is an internal bind address', async () => {
    const response = await GET(
      request('GET', undefined, {
        'x-forwarded-host': 'example.com',
        'x-forwarded-proto': 'https',
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      triggerLink:
        'https://example.com/api/update-check-trigger?token=toke****cret',
    });
  });

  it('generates a random token for the current user', async () => {
    const response = await POST(request('POST', { action: 'generate' }));

    expect(response.status).toBe(200);
    expect(createToken).toHaveBeenCalledWith('alice');
    expect(clearCache).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      fullToken: 'token.secret',
      fullTriggerLink:
        'http://localhost/api/update-check-trigger?token=token.secret',
    });
  });

  it('rejects user-specified token generation options', async () => {
    const response = await POST(request('POST', { expiresAt: 5000 }));

    expect(response.status).toBe(400);
    expect(createToken).not.toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();
  });

  it('reveals the full trigger link through a dedicated operation', async () => {
    const response = await PUT(request('PUT', { action: 'reveal' }));

    expect(response.status).toBe(200);
    expect(revealToken).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toMatchObject({
      fullToken: 'token.secret',
      fullTriggerLink:
        'http://localhost/api/update-check-trigger?token=token.secret',
    });
  });

  it('reveals the current user token even when the effective status is disabled', async () => {
    getStatus.mockResolvedValue({
      ...status,
      enabled: false,
      adminTriggerEnabled: false,
      effectiveEnabled: false,
    });

    const response = await PUT(request('PUT', { action: 'reveal' }));

    expect(response.status).toBe(200);
    expect(revealToken).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toMatchObject({
      fullToken: 'token.secret',
      fullTriggerLink:
        'http://localhost/api/update-check-trigger?token=token.secret',
    });
  });

  it('rejects username in generate requests', async () => {
    const response = await POST(request('POST', { username: 'bob' }));

    expect(response.status).toBe(400);
    expect(createToken).not.toHaveBeenCalled();
  });

  it('rejects manual token content in generate requests', async () => {
    const response = await POST(request('POST', { token: 'custom-token' }));

    expect(response.status).toBe(400);
    expect(createToken).not.toHaveBeenCalled();
  });

  it('rejects user token rotation', async () => {
    const response = await PATCH(request('PATCH', { action: 'rotate' }));

    expect(response.status).toBe(400);
    expect(rotateToken).not.toHaveBeenCalled();
  });

  it('enables and disables a token', async () => {
    const response = await PATCH(request('PATCH', { enabled: false }));

    expect(response.status).toBe(200);
    expect(setUserEnabled).toHaveBeenCalledWith('alice', false);
  });

  it('delegates user re-enable requests to the token service', async () => {
    getStatus.mockResolvedValue({
      ...status,
      enabled: false,
      disabledReason: 'rate_limit_exceeded',
      disabledAt: 2000,
      disabledSource: 'system',
    });

    const response = await PATCH(request('PATCH', { enabled: true }));

    expect(response.status).toBe(200);
    expect(setUserEnabled).toHaveBeenCalledWith('alice', true);
  });

  it('rejects user expiration updates', async () => {
    const setResponse = await PATCH(request('PATCH', { expiresAt: 5000 }));
    const expireResponse = await PATCH(request('PATCH', { action: 'expire' }));

    expect(setResponse.status).toBe(400);
    expect(expireResponse.status).toBe(400);
    expect(setExpiresAt).not.toHaveBeenCalled();
    expect(expireToken).not.toHaveBeenCalled();
  });

  it('rejects username in patch requests', async () => {
    const response = await PATCH(
      request('PATCH', { username: 'bob', enabled: false }),
    );

    expect(response.status).toBe(400);
    expect(setUserEnabled).not.toHaveBeenCalled();
  });

  it('rejects user token deletion', async () => {
    const response = await DELETE(request('DELETE'));

    expect(response.status).toBe(403);
    expect(deleteToken).not.toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();
  });
});

function adminConfig(
  alice?: Partial<AdminConfig['UserConfig']['Users'][number]>,
  users?: AdminConfig['UserConfig']['Users'],
): AdminConfig {
  return {
    UserConfig: {
      Users: users ?? [
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
          allowCustomSchedule: true,
          ...alice,
        },
      ],
    },
  } as AdminConfig;
}

function request(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(
    `http://${headers['x-forwarded-host'] ? '0.0.0.0:3000' : 'localhost'}/api/user/watching-updates/trigger-link`,
    {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}
