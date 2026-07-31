/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/notification-provider-bootstrap', () => ({
  notificationProviderRegistry: {
    get: jest.fn(),
  },
}));
jest.mock('@/lib/notification/notification-settings-service', () => ({
  notificationSettingsService: {
    getForUser: jest.fn(),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationProviderRegistry } from '@/lib/notification/notification-provider-bootstrap';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';
import { POST } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const getForUser = notificationSettingsService.getForUser as jest.Mock;
const getProvider = notificationProviderRegistry.get as jest.Mock;
let providerTest: jest.Mock;

function settings(channel: Record<string, unknown>) {
  return {
    notificationCenterEnabled: true,
    inboxEnabled: true,
    watchingUpdateFoundEnabled: true,
    watchingUpdateFailedEnabled: true,
    channels: [channel],
  };
}

describe('notification settings test API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    providerTest = jest.fn();
    getProvider.mockReturnValue({
      type: 'wechat_work',
      test: providerTest,
    });
    getAuth.mockReturnValue({ username: 'alice', role: 'admin' });
    getForUser.mockResolvedValue(
      settings({
        id: 'wc-1',
        type: 'wechat_work',
        name: '企业微信',
        enabled: true,
        subscribedEvents: ['watching.update_found'],
        config: {
          webhookUrl:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
        },
      }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    getAuth.mockReturnValue(null);

    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(401);
    expect(getProvider).not.toHaveBeenCalled();
  });

  it('rejects normal users', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(403);
    expect(getProvider).not.toHaveBeenCalled();
  });

  it('uses ProviderRegistry and Provider.test for a channel test', async () => {
    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(200);
    expect(getProvider).toHaveBeenCalledWith('wechat_work');
    expect(providerTest).toHaveBeenCalledWith({
      id: 'wc-1',
      type: 'wechat_work',
      name: '企业微信',
      enabled: true,
      subscribedEvents: ['watching.update_found'],
      config: {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
        userId: 'alice',
      },
    });
  });

  it('returns 403 when channel is disabled', async () => {
    getForUser.mockResolvedValue(
      settings({
        id: 'wc-1',
        type: 'wechat_work',
        name: '企业微信',
        enabled: false,
        subscribedEvents: ['watching.update_found'],
        config: {
          webhookUrl:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
        },
      }),
    );

    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(403);
    expect(providerTest).not.toHaveBeenCalled();
  });

  it('returns 403 when the notification center is disabled', async () => {
    getForUser.mockResolvedValue({
      ...settings({
        id: 'wc-1',
        type: 'wechat_work',
        name: '企业微信',
        enabled: true,
        subscribedEvents: ['watching.update_found'],
        config: {
          webhookUrl:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
        },
      }),
      notificationCenterEnabled: false,
    });

    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(403);
    expect(providerTest).not.toHaveBeenCalled();
  });

  it('returns 400 when the channel provider is not registered', async () => {
    getProvider.mockReturnValue(null);

    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(400);
    expect(providerTest).not.toHaveBeenCalled();
  });

  it('returns 502 when provider test fails', async () => {
    providerTest.mockRejectedValueOnce(new Error('boom'));

    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(502);
  });
});

function request(body: unknown) {
  return new NextRequest(
    'http://localhost/api/user/notification-settings/test',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}
