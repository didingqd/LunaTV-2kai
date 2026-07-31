/** @jest-environment node */

jest.mock('@/lib/db', () => ({
  db: {},
}));

import {
  InboxNotificationRepository,
  type InboxNotificationStore,
} from './inbox-notification-repository';
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

describe('InboxNotificationRepository', () => {
  it('appends and lists notifications per user', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );

    await repository.append('alice', notification({ id: 'a-1' }));
    await repository.append('bob', notification({ id: 'b-1', userId: 'bob' }));
    await repository.append('alice', notification({ id: 'a-2', createdAt: 2_000 }));

    await expect(repository.listForUser('alice')).resolves.toEqual([
      notification({ id: 'a-2', createdAt: 2_000 }),
      notification({ id: 'a-1' }),
    ]);
    await expect(repository.listForUser('bob')).resolves.toEqual([
      notification({ id: 'b-1', userId: 'bob' }),
    ]);
  });

  it('marks a notification as read or unread', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );

    await repository.append('alice', notification());

    await expect(repository.markRead('alice', 'n-1', true, 2_000)).resolves.toEqual(
      notification({ read: true, readAt: 2_000 }),
    );
    await expect(repository.markRead('alice', 'n-1', false, null)).resolves.toEqual(
      notification({ read: false, readAt: null }),
    );
  });

  it('returns null when marking a missing notification', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );

    await expect(
      repository.markRead('alice', 'missing', true, 2_000),
    ).resolves.toBeNull();
  });

  it('deletes a single notification', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );

    await repository.append('alice', notification({ id: 'n-1' }));
    await repository.append('alice', notification({ id: 'n-2' }));

    await expect(repository.delete('alice', 'n-2')).resolves.toBe(true);
    await expect(repository.listForUser('alice')).resolves.toEqual([
      notification({ id: 'n-1' }),
    ]);
  });

  it('clears all notifications for a user', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );

    await repository.append('alice', notification({ id: 'n-1' }));
    await repository.append('alice', notification({ id: 'n-2' }));

    await repository.clearForUser('alice');

    await expect(repository.listForUser('alice')).resolves.toEqual([]);
  });
});
