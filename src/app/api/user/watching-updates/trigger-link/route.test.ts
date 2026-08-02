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
const setExpiresAt = triggerTokenService.setExpiresAt as jest.Mock;
const expireToken = triggerTokenService.expireToken as jest.Mock;
const revealToken = triggerTokenService.revealToken as jest.Mock;
const deleteToken = triggerTokenService.deleteToken as jest.Mock;

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

describe('user watching updates trigger link API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getAuth.mockReturnValue({ username: 'alice' });
    loadConfig.mockResolvedValue(adminConfig());
    getStatus.mockResolvedValue(status);
    createToken.mockResolvedValue({ ...status, plainToken: 'token.secret' });
    rotateToken.mockResolvedValue({ ...status, plainToken: 'token.new-secret' });
    revealToken.mockResolvedValue({ ...status, plainToken: 'token.secret' });
    setEnabled.mockResolvedValue({ ...status, enabled: false });
    setExpiresAt.mockResolvedValue({ ...status, expiresAt: 5000 });
    expireToken.mockResolvedValue({ ...status, expiresAt: 2000, expired: true });
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

  it('returns 403 when trigger links are not allowed', async () => {
    loadConfig.mockResolvedValue(adminConfig({ allowTriggerLink: false }));

    const response = await POST(request('POST'));

    expect(response.status).toBe(403);
    expect(createToken).not.toHaveBeenCalled();
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

  it('creates a token without returning the plain token by default', async () => {
    const response = await POST(request('POST', { expiresAt: 5000 }));

    expect(response.status).toBe(200);
    expect(createToken).toHaveBeenCalledWith('alice', { expiresAt: 5000 });
    expect(clearCache).toHaveBeenCalled();
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('token.secret');
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

  it('rejects username in create requests', async () => {
    const response = await POST(request('POST', { username: 'bob' }));

    expect(response.status).toBe(400);
    expect(createToken).not.toHaveBeenCalled();
  });

  it('rotates a token for the signed-in user without revealing it', async () => {
    const response = await PATCH(request('PATCH', { action: 'rotate' }));

    expect(response.status).toBe(200);
    expect(rotateToken).toHaveBeenCalledWith('alice');
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('token.new-secret');
  });

  it('enables and disables a token', async () => {
    const response = await PATCH(request('PATCH', { enabled: false }));

    expect(response.status).toBe(200);
    expect(setEnabled).toHaveBeenCalledWith('alice', false);
  });

  it('sets and expires a token', async () => {
    const setResponse = await PATCH(request('PATCH', { expiresAt: 5000 }));
    const expireResponse = await PATCH(request('PATCH', { action: 'expire' }));

    expect(setResponse.status).toBe(200);
    expect(expireResponse.status).toBe(200);
    expect(setExpiresAt).toHaveBeenCalledWith('alice', 5000);
    expect(expireToken).toHaveBeenCalledWith('alice');
  });

  it('rejects username in patch requests', async () => {
    const response = await PATCH(
      request('PATCH', { username: 'bob', enabled: false }),
    );

    expect(response.status).toBe(400);
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it('deletes the token for the signed-in user', async () => {
    const response = await DELETE(request('DELETE'));

    expect(response.status).toBe(200);
    expect(deleteToken).toHaveBeenCalledWith('alice');
    expect(clearCache).toHaveBeenCalled();
  });
});

function adminConfig(
  alice?: Partial<AdminConfig['UserConfig']['Users'][number]>,
  users?: AdminConfig['UserConfig']['Users'],
): AdminConfig {
  return {
    UserConfig: {
      Users:
        users ??
        [
          {
            username: 'alice',
            role: 'user',
            updateCheckBackendEnabled: true,
            allowCustomSchedule: true,
            allowTriggerLink: true,
            ...alice,
          },
        ],
    },
  } as AdminConfig;
}

function request(method: string, body?: unknown) {
  return new NextRequest(
    'http://localhost/api/user/watching-updates/trigger-link',
    {
      method,
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}
