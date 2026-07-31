/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/notification-settings-service', () => ({
  notificationSettingsService: {
    createChannel: jest.fn(),
    toPublicSettings: jest.fn((settings) => ({
      ...settings,
      channels: settings.channels.map((channel) =>
        channel.type === 'wechat_work'
          ? {
              ...channel,
              config: {
                webhookUrl: 'https://qyapi.weixin.qq.com/****abcd',
              },
            }
          : channel,
      ),
    })),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';
import { POST } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const createChannel = notificationSettingsService.createChannel as jest.Mock;
const toPublicSettings =
  notificationSettingsService.toPublicSettings as jest.Mock;

describe('user notification channel create API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    toPublicSettings.mockImplementation((settings) => ({
      ...settings,
      channels: settings.channels.map((channel) =>
        channel.type === 'wechat_work'
          ? {
              ...channel,
              config: {
                webhookUrl: 'https://qyapi.weixin.qq.com/****abcd',
              },
            }
          : channel,
      ),
    }));
    getAuth.mockReturnValue({ username: 'alice', role: 'admin' });
    createChannel.mockResolvedValue({
      inboxEnabled: true,
      watchingUpdateFoundEnabled: true,
      watchingUpdateFailedEnabled: true,
      channels: [
        {
          id: 'inbox',
          type: 'inbox',
          name: '站内通知',
          enabled: true,
          subscribedEvents: ['watching.update_found'],
          config: {},
        },
        {
          id: 'wc-1',
          type: 'wechat_work',
          name: '企业微信',
          enabled: true,
          subscribedEvents: ['watching.update_failed'],
          config: {
            webhookUrl:
              'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
          },
        },
      ],
    });
  });

  it('returns 401 when unauthenticated', async () => {
    getAuth.mockReturnValue(null);

    const response = await POST(request({}));

    expect(response.status).toBe(401);
    expect(createChannel).not.toHaveBeenCalled();
  });

  it('rejects normal users from creating channels', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await POST(
      request({
        type: 'wechat_work',
        config: { webhookUrl: 'https://example.com/hook' },
      }),
    );

    expect(response.status).toBe(403);
    expect(createChannel).not.toHaveBeenCalled();
  });

  it('creates a provider-backed channel for the current admin with subscribedEvents', async () => {
    const response = await POST(
      request({
        type: 'wechat_work',
        name: '我的企业微信',
        username: 'bob',
        subscribedEvents: ['watching.update_found'],
        config: {
          webhookUrl:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();

    const valid = await POST(
      request({
        type: 'wechat_work',
        name: '我的企业微信',
        subscribedEvents: ['watching.update_failed'],
        config: {
          webhookUrl:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
        },
      }),
    );
    expect(valid.status).toBe(200);
    expect(createChannel).toHaveBeenCalledWith('alice', {
      type: 'wechat_work',
      name: '我的企业微信',
      subscribedEvents: ['watching.update_failed'],
      config: {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
    });
    const body = await valid.json();
    expect(body.settings.channels[1].config.webhookUrl).toBe(
      'https://qyapi.weixin.qq.com/****abcd',
    );
  });
});

function request(body: unknown) {
  return new NextRequest(
    'http://localhost/api/user/notification-settings/channels',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}
