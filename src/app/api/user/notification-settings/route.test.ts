/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/notification-settings-service', () => ({
  notificationSettingsService: {
    getForUser: jest.fn(),
    save: jest.fn(),
    restoreDefault: jest.fn(),
    toPublicSettings: jest.fn((settings) => settings),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';
import { DELETE, GET, PATCH } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const getForUser = notificationSettingsService.getForUser as jest.Mock;
const save = notificationSettingsService.save as jest.Mock;
const restoreDefault = notificationSettingsService.restoreDefault as jest.Mock;
const toPublicSettings =
  notificationSettingsService.toPublicSettings as jest.Mock;

const defaultSettings = {
  inboxEnabled: true,
  watchingUpdateFoundEnabled: true,
  watchingUpdateFailedEnabled: true,
  channels: [
    {
      id: 'inbox',
      type: 'inbox',
      name: '站内通知',
      enabled: true,
      config: {},
    },
  ],
};

describe('user notification settings API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    toPublicSettings.mockImplementation((settings) => settings);
    getAuth.mockReturnValue({ username: 'alice', role: 'admin' });
    getForUser.mockResolvedValue(defaultSettings);
    save.mockResolvedValue({ ...defaultSettings, inboxEnabled: false });
    restoreDefault.mockResolvedValue(defaultSettings);
  });

  it('returns 401 when unauthenticated', async () => {
    getAuth.mockReturnValue(null);

    const response = await GET(request('GET'));

    expect(response.status).toBe(401);
    expect(getForUser).not.toHaveBeenCalled();
  });

  it('rejects normal users from reading management settings', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await GET(request('GET'));

    expect(response.status).toBe(403);
    expect(getForUser).not.toHaveBeenCalled();
  });

  it('reads settings for current admin only', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/user/notification-settings?username=bob',
      ),
    );

    expect(response.status).toBe(200);
    expect(getForUser).toHaveBeenCalledWith('alice');
    expect(getForUser).not.toHaveBeenCalledWith('bob');
    await expect(response.json()).resolves.toEqual({
      settings: defaultSettings,
    });
  });

  it('rejects normal users from modifying settings', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await PATCH(request('PATCH', { inboxEnabled: false }));

    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it('saves legacy-compatible settings for administrators', async () => {
    const response = await PATCH(
      request('PATCH', {
        inboxEnabled: false,
        watchingUpdateFailedEnabled: false,
      }),
    );

    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith('alice', {
      inboxEnabled: false,
      watchingUpdateFailedEnabled: false,
    });
  });

  it('rejects forbidden fields', async () => {
    const response = await PATCH(
      request('PATCH', {
        username: 'bob',
        inboxEnabled: false,
      }),
    );

    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects normal users from restoring defaults', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await DELETE(request('DELETE'));

    expect(response.status).toBe(403);
    expect(restoreDefault).not.toHaveBeenCalled();
  });

  it('restores defaults for administrators', async () => {
    const response = await DELETE(request('DELETE'));

    expect(response.status).toBe(200);
    expect(restoreDefault).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toEqual({
      settings: defaultSettings,
    });
  });
});

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/user/notification-settings', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
