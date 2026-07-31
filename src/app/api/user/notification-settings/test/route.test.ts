/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/channels/wechat-work-notification-channel', () => ({
  WeChatWorkNotificationChannel: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
}));
jest.mock('@/lib/notification/notification-settings-service', () => ({
  notificationSettingsService: {
    getForUser: jest.fn(),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { WeChatWorkNotificationChannel } from '@/lib/notification/channels/wechat-work-notification-channel';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';
import { POST } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const getForUser = notificationSettingsService.getForUser as jest.Mock;
const WeChatWorkChannelMock = WeChatWorkNotificationChannel as unknown as jest.Mock;
let sendMock: jest.Mock;

function settings(channel: Record<string, unknown>) {
  return {
    inboxEnabled: true,
    watchingUpdateFoundEnabled: true,
    watchingUpdateFailedEnabled: true,
    channels: [channel],
  };
}

describe('notification settings test API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    sendMock = jest.fn();
    WeChatWorkChannelMock.mockImplementation(() => ({
      send: sendMock,
    }));
    getAuth.mockReturnValue({ username: 'alice' });
    getForUser.mockResolvedValue(
      settings({
        id: 'wc-1',
        type: 'wechat_work',
        name: '企业微信',
        enabled: true,
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
  });

  it('sends a WeChat Work test message', async () => {
    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(200);
    expect(WeChatWorkChannelMock).toHaveBeenCalledWith({
      webhookUrl:
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
    });
    const instance = WeChatWorkChannelMock.mock.results[0].value;
    expect(instance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'alice',
        title: '测试通知',
      }),
    );
  });

  it('returns 403 when channel is disabled', async () => {
    getForUser.mockResolvedValue(
      settings({
        id: 'wc-1',
        type: 'wechat_work',
        name: '企业微信',
        enabled: false,
        config: {
          webhookUrl:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
        },
      }),
    );

    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(403);
  });

  it('returns 400 when webhook URL is empty', async () => {
    getForUser.mockResolvedValue(
      settings({
        id: 'wc-1',
        type: 'wechat_work',
        name: '企业微信',
        enabled: true,
        config: {},
      }),
    );

    const response = await POST(request({ channelId: 'wc-1' }));

    expect(response.status).toBe(400);
  });

  it('returns 502 when sending fails', async () => {
    WeChatWorkChannelMock.mockImplementationOnce(() => ({
      send: jest.fn(async () => {
        throw new Error('boom');
      }),
    }));

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
