/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/notification/inbox-notification-service', () => ({
  inboxNotificationService: {
    markRead: jest.fn(),
    delete: jest.fn(),
  },
}));

import { getAuthInfoFromCookie } from '@/lib/auth';
import { inboxNotificationService } from '@/lib/notification/inbox-notification-service';
import { DELETE, PATCH } from './route';

const getAuth = getAuthInfoFromCookie as jest.Mock;
const markRead = inboxNotificationService.markRead as jest.Mock;
const deleteNotification = inboxNotificationService.delete as jest.Mock;

describe('user notification detail API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getAuth.mockReturnValue({ username: 'alice' });
    markRead.mockResolvedValue({
      id: 'n-1',
      userId: 'alice',
      type: 'system',
      title: 'Title',
      content: 'Content',
      createdAt: 1_000,
      read: true,
      readAt: 2_000,
    });
    deleteNotification.mockResolvedValue(undefined);
  });

  it('returns 401 when the user is not signed in', async () => {
    getAuth.mockReturnValue(null);

    const response = await PATCH(request('PATCH', { read: true }), context('n-1'));

    expect(response.status).toBe(401);
    expect(markRead).not.toHaveBeenCalled();
  });

  it('marks a notification read for the signed-in user only', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/user/notifications/n-1?username=bob', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      }),
      context('n-1'),
    );

    expect(response.status).toBe(200);
    expect(markRead).toHaveBeenCalledWith('alice', 'n-1', true);
    expect(markRead).not.toHaveBeenCalledWith('bob', 'n-1', true);
  });

  it('rejects invalid patch bodies', async () => {
    const response = await PATCH(
      request('PATCH', { username: 'bob', read: true }),
      context('n-1'),
    );

    expect(response.status).toBe(400);
    expect(markRead).not.toHaveBeenCalled();
  });

  it('returns 404 when the notification is missing', async () => {
    markRead.mockRejectedValue(new Error('NOTIFICATION_NOT_FOUND'));

    const response = await PATCH(request('PATCH', { read: true }), context('missing'));

    expect(response.status).toBe(404);
  });

  it('deletes a notification for the signed-in user only', async () => {
    const response = await DELETE(request('DELETE'), context('n-1'));

    expect(response.status).toBe(200);
    expect(deleteNotification).toHaveBeenCalledWith('alice', 'n-1');
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it('returns 404 when deleting a missing notification', async () => {
    deleteNotification.mockRejectedValue(new Error('NOTIFICATION_NOT_FOUND'));

    const response = await DELETE(request('DELETE'), context('missing'));

    expect(response.status).toBe(404);
  });
});

function context(id: string) {
  return {
    params: Promise.resolve({ id }),
  };
}

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/user/notifications/n-1', {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
