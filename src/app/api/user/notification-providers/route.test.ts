/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/notification-provider-bootstrap', () => ({
  notificationProviderRegistry: {
    list: jest.fn(),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationProviderRegistry } from '@/lib/notification/notification-provider-bootstrap';
import { GET } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const listProviders = notificationProviderRegistry.list as jest.Mock;

describe('user notification providers API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getAuth.mockReturnValue({ username: 'alice', role: 'admin' });
    listProviders.mockReturnValue([
      {
        type: 'inbox',
        name: '站内通知',
        configSchema: { fields: [] },
        capabilities: {
          canCreate: false,
          canEdit: true,
          canDelete: false,
          canTest: false,
          canToggle: true,
          canSend: true,
        },
      },
      {
        type: 'wechat_work',
        name: '企业微信',
        configSchema: {
          fields: [{ key: 'webhookUrl', type: 'url', label: 'Webhook 地址' }],
        },
        capabilities: {
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canTest: true,
          canToggle: true,
          canSend: true,
        },
      },
    ]);
  });

  it('returns provider schema metadata for administrators', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providers: [
        expect.objectContaining({
          type: 'inbox',
          displayName: '站内通知',
          configSchema: { fields: [] },
          capabilities: expect.objectContaining({
            canDelete: false,
            canSend: true,
          }),
        }),
        expect.objectContaining({
          type: 'wechat_work',
          displayName: '企业微信',
          capabilities: expect.objectContaining({
            canCreate: true,
            canSend: true,
          }),
        }),
      ],
    });
  });

  it('rejects normal users', async () => {
    getAuth.mockReturnValue({ username: 'bob', role: 'user' });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(listProviders).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    getAuth.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(listProviders).not.toHaveBeenCalled();
  });
});

function request() {
  return new NextRequest('http://localhost/api/user/notification-providers');
}
