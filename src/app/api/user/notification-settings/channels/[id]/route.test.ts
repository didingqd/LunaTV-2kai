/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/notification-settings-service', () => ({
  notificationSettingsService: {
    updateChannel: jest.fn(),
    deleteChannel: jest.fn(),
    toPublicSettings: jest.fn((settings) => settings),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';
import { DELETE, PATCH } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const updateChannel = notificationSettingsService.updateChannel as jest.Mock;
const deleteChannel = notificationSettingsService.deleteChannel as jest.Mock;

const settings = {
  inboxEnabled: true,
  watchingUpdateFoundEnabled: true,
  watchingUpdateFailedEnabled: true,
  channels: [],
};

describe('user notification channel item API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getAuth.mockReturnValue({ username: 'alice', role: 'admin' });
    updateChannel.mockResolvedValue(settings);
    deleteChannel.mockResolvedValue(settings);
  });

  it('updates a channel for the current admin with subscribedEvents', async () => {
    const response = await PATCH(
      request('PATCH', {
        enabled: false,
        subscribedEvents: ['watching.update_failed'],
        config: { webhookUrl: 'https://example.com/hook' },
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(updateChannel).toHaveBeenCalledWith('alice', 'wc-1', {
      enabled: false,
      subscribedEvents: ['watching.update_failed'],
      config: { webhookUrl: 'https://example.com/hook' },
    });
  });

  it('rejects normal users from updating channels', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await PATCH(request('PATCH', { enabled: false }), params());

    expect(response.status).toBe(403);
    expect(updateChannel).not.toHaveBeenCalled();
  });

  it('deletes a channel for the current admin', async () => {
    const response = await DELETE(request('DELETE'), params());

    expect(response.status).toBe(200);
    expect(deleteChannel).toHaveBeenCalledWith('alice', 'wc-1');
  });

  it('rejects normal users from deleting channels', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await DELETE(request('DELETE'), params());

    expect(response.status).toBe(403);
    expect(deleteChannel).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    getAuth.mockReturnValue(null);

    const response = await DELETE(request('DELETE'), params());

    expect(response.status).toBe(401);
    expect(deleteChannel).not.toHaveBeenCalled();
  });
});

function request(method: string, body?: unknown) {
  return new NextRequest(
    'http://localhost/api/user/notification-settings/channels/wc-1',
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function params() {
  return { params: Promise.resolve({ id: 'wc-1' }) };
}
