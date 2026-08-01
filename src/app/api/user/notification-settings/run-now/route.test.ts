/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/notification-dispatcher', () => ({
  notificationDispatcher: {
    dispatchEvent: jest.fn(),
  },
}));
jest.mock('@/lib/system-config-repository', () => ({
  systemConfigRepository: {
    getUpdateCheckConfig: jest.fn(),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationDispatcher } from '@/lib/notification/notification-dispatcher';
import { NotificationEventType } from '@/lib/notification/notification-types';
import { systemConfigRepository } from '@/lib/system-config-repository';
import { POST } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const dispatchEvent = notificationDispatcher.dispatchEvent as jest.Mock;
const getUpdateCheckConfig =
  systemConfigRepository.getUpdateCheckConfig as jest.Mock;

describe('notification settings run-now API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    getAuth.mockReturnValue({ username: 'alice', role: 'admin' });
    getUpdateCheckConfig.mockResolvedValue({
      updateCheckTimezone: 'Asia/Shanghai',
    });
    dispatchEvent.mockResolvedValue({
      success: true,
      totalChannels: 2,
      succeeded: 2,
      failed: 0,
      errors: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    getAuth.mockReturnValue(null);

    const response = await POST(
      request({ eventType: NotificationEventType.WATCHING_UPDATE_FOUND }),
    );

    expect(response.status).toBe(401);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('rejects normal users', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await POST(
      request({ eventType: NotificationEventType.WATCHING_UPDATE_FOUND }),
    );

    expect(response.status).toBe(403);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('creates a debug NotificationEvent and dispatches it through dispatcher', async () => {
    const response = await POST(
      request({ eventType: NotificationEventType.WATCHING_UPDATE_FOUND }),
    );

    expect(response.status).toBe(200);
    expect(dispatchEvent).toHaveBeenCalledWith({
      id: expect.any(String),
      type: NotificationEventType.WATCHING_UPDATE_FOUND,
      userId: 'alice',
      data: {
        title: '测试更新通知',
        message: '这是 Run Now 生成的测试通知',
        content: '这是 Run Now 生成的测试通知',
        source: 'notification-debug',
        metadata: {
          debug: true,
          timezone: 'Asia/Shanghai',
          displayTime: '2023-11-15 06:13:20',
        },
        timestamp: 1_700_000_000_000,
        displayTime: '2023-11-15 06:13:20',
      },
      createdAt: 1_700_000_000_000,
    });
    await expect(response.json()).resolves.toEqual({
      eventType: NotificationEventType.WATCHING_UPDATE_FOUND,
      success: true,
      totalChannels: 2,
      succeeded: 2,
      failed: 0,
      errors: [],
    });
  });

  it('returns dispatcher failures without exposing provider config', async () => {
    dispatchEvent.mockResolvedValue({
      success: false,
      totalChannels: 2,
      succeeded: 1,
      failed: 1,
      errors: [{ channel: '企业微信', message: 'send failed' }],
    });

    const response = await POST(
      request({ eventType: NotificationEventType.WATCHING_UPDATE_FOUND }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eventType: NotificationEventType.WATCHING_UPDATE_FOUND,
      success: false,
      totalChannels: 2,
      succeeded: 1,
      failed: 1,
      errors: [{ channel: '企业微信', message: 'send failed' }],
    });
  });
});

function request(body: unknown) {
  return new NextRequest(
    'http://localhost/api/user/notification-settings/run-now',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}
