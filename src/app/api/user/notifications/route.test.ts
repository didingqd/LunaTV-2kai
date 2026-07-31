/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/inbox-notification-service', () => ({
  inboxNotificationService: {
    listForUser: jest.fn(),
    clearForUser: jest.fn(),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { inboxNotificationService } from '@/lib/notification/inbox-notification-service';
import { DELETE, GET } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const listForUser = inboxNotificationService.listForUser as jest.Mock;
const clearForUser = inboxNotificationService.clearForUser as jest.Mock;

describe('user notifications API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getAuth.mockReturnValue({ username: 'alice' });
    listForUser.mockResolvedValue({
      notifications: [
        {
          id: 'n-1',
          userId: 'alice',
          type: 'system',
          title: 'Title',
          content: 'Content',
          createdAt: 1_000,
          read: false,
          readAt: null,
        },
      ],
      total: 1,
      unread: 1,
    });
    clearForUser.mockResolvedValue(undefined);
  });

  it('returns 401 when the user is not signed in', async () => {
    getAuth.mockReturnValue(null);

    const response = await GET(request('GET'));

    expect(response.status).toBe(401);
    expect(listForUser).not.toHaveBeenCalled();
  });

  it('reads notifications for the signed-in user only', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/user/notifications?username=bob'),
    );

    expect(response.status).toBe(200);
    expect(listForUser).toHaveBeenCalledWith('alice');
    expect(listForUser).not.toHaveBeenCalledWith('bob');
    await expect(response.json()).resolves.toEqual({
      notifications: [
        {
          id: 'n-1',
          userId: 'alice',
          type: 'system',
          title: 'Title',
          content: 'Content',
          createdAt: 1_000,
          read: false,
          readAt: null,
        },
      ],
      total: 1,
      unread: 1,
    });
  });

  it('clears all notifications for the signed-in user', async () => {
    const response = await DELETE(request('DELETE'));

    expect(response.status).toBe(200);
    expect(clearForUser).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toEqual({
      success: true,
      notifications: [],
      total: 0,
      unread: 0,
    });
  });
});

function request(method: string) {
  return new NextRequest('http://localhost/api/user/notifications', {
    method,
  });
}
