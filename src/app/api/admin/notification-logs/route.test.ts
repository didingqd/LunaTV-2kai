/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/admin-auth', () => ({
  getAdminRoleFromRequest: jest.fn(),
}));
jest.mock('@/lib/notification/notification-log-repository', () => ({
  notificationSendLogRepository: { list: jest.fn() },
}));

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { notificationSendLogRepository } from '@/lib/notification/notification-log-repository';
import { GET } from './route';

const getRole = getAdminRoleFromRequest as jest.Mock;
const listLogs = notificationSendLogRepository.list as jest.Mock;

function request(query = '') {
  return new NextRequest(
    `http://localhost/api/admin/notification-logs${query}`,
  );
}

describe('GET /api/admin/notification-logs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRole.mockResolvedValue('admin');
    listLogs.mockResolvedValue([
      {
        eventType: 'watching.update_found',
        channelId: 'channel-1',
        providerType: 'webhook',
        status: 'failed',
        error: 'send failed',
        createdAt: 1_000,
      },
    ]);
  });

  it('returns notification logs for admins', async () => {
    const response = await GET(request('?limit=50'));

    expect(response.status).toBe(200);
    expect(listLogs).toHaveBeenCalledWith({ limit: 50 });
    await expect(response.json()).resolves.toEqual({
      logs: [
        {
          eventType: 'watching.update_found',
          provider: 'webhook',
          channelId: 'channel-1',
          status: 'failed',
          error: 'send failed',
          time: 1_000,
        },
      ],
    });
  });

  it('returns 403 for normal users', async () => {
    getRole.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(listLogs).not.toHaveBeenCalled();
  });

  it('rejects invalid limits', async () => {
    const response = await GET(request('?limit=9999'));

    expect(response.status).toBe(400);
    expect(listLogs).not.toHaveBeenCalled();
  });
});
