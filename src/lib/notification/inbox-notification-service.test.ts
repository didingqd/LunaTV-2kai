/** @jest-environment node */

jest.mock('@/lib/db', () => ({
  db: {},
}));

import {
  InboxNotificationRepository,
  type InboxNotificationStore,
} from './inbox-notification-repository';
import { InboxNotificationService } from './inbox-notification-service';
import {
  NotificationMessageType,
  type InboxNotification,
} from './notification-types';

class MemoryInboxNotificationStore implements InboxNotificationStore {
  readonly values = new Map<string, unknown>();

  async getCache(key: string): Promise<unknown | null> {
    return this.values.get(key) ?? null;
  }

  async setCache(key: string, data: unknown): Promise<void> {
    this.values.set(key, data);
  }

  async deleteCache(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function notification(
  overrides: Partial<InboxNotification> = {},
): InboxNotification {
  return {
    id: 'n-1',
    userId: 'alice',
    type: NotificationMessageType.WATCHING_UPDATE_FOUND,
    title: 'New episode',
    content: 'Episode 10 is available.',
    payload: { mediaId: 'm-1' },
    read: false,
    createdAt: 1_000,
    readAt: null,
    ...overrides,
  };
}

describe('InboxNotificationService', () => {
  it('returns notifications with total and unread counts', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );
    const service = new InboxNotificationService(repository, () => 3_000);

    await repository.append('alice', notification({ id: 'n-1' }));
    await repository.append(
      'alice',
      notification({ id: 'n-2', read: true, readAt: 2_000 }),
    );

    await expect(service.listForUser('alice')).resolves.toEqual({
      notifications: [
        notification({ id: 'n-2', read: true, readAt: 2_000 }),
        notification({ id: 'n-1' }),
      ],
      total: 2,
      unread: 1,
    });
  });

  it('marks a notification read and unread', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );
    const service = new InboxNotificationService(repository, () => 4_000);

    await repository.append('alice', notification());

    await expect(service.markRead('alice', 'n-1', true)).resolves.toEqual(
      notification({ read: true, readAt: 4_000 }),
    );
    await expect(service.markRead('alice', 'n-1', false)).resolves.toEqual(
      notification({ read: false, readAt: null }),
    );
  });

  it('throws when marking a missing notification', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );
    const service = new InboxNotificationService(repository);

    await expect(service.markRead('alice', 'missing', true)).rejects.toThrow(
      'NOTIFICATION_NOT_FOUND',
    );
  });

  it('deletes one or all notifications', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );
    const service = new InboxNotificationService(repository);

    await repository.append('alice', notification({ id: 'n-1' }));
    await repository.append('alice', notification({ id: 'n-2' }));

    await service.delete('alice', 'n-2');
    await expect(service.listForUser('alice')).resolves.toMatchObject({
      total: 1,
      unread: 1,
    });

    await service.clearForUser('alice');
    await expect(service.listForUser('alice')).resolves.toEqual({
      notifications: [],
      total: 0,
      unread: 0,
    });
  });
});
