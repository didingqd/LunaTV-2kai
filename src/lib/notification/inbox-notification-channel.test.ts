/** @jest-environment node */

import { NotificationDispatcher } from './notification-dispatcher';
import { InboxNotificationChannel } from './inbox-notification-channel';
import {
  InboxNotificationRepository,
  type InboxNotificationStore,
} from './inbox-notification-repository';
import { notificationDispatcher } from './notification-dispatcher';
import { NotificationMessageType } from './notification-types';

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

describe('InboxNotificationChannel', () => {
  it('stores a notification when send() is called', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );
    const channel = new InboxNotificationChannel(repository, () => 'inbox-1');

    await channel.send({
      userId: 'alice',
      type: NotificationMessageType.SYSTEM,
      title: 'Title',
      content: 'Content',
      createdAt: 1_000,
      payload: { key: 'value' },
    });

    await expect(repository.listForUser('alice')).resolves.toEqual([
      {
        id: 'inbox-1',
        userId: 'alice',
        type: NotificationMessageType.SYSTEM,
        title: 'Title',
        content: 'Content',
        createdAt: 1_000,
        payload: { key: 'value' },
        read: false,
        readAt: null,
      },
    ]);
  });

  it('can be invoked through NotificationDispatcher', async () => {
    const repository = new InboxNotificationRepository(
      new MemoryInboxNotificationStore(),
    );
    const dispatcher = new NotificationDispatcher({
      shouldDispatch: jest.fn(async () => true),
    });
    dispatcher.register(new InboxNotificationChannel(repository, () => 'inbox-2'));

    const result = await dispatcher.dispatch({
      userId: 'alice',
      type: NotificationMessageType.SYSTEM,
      title: 'Title',
      content: 'Content',
      createdAt: 2_000,
    });

    expect(result).toEqual({
      success: true,
      totalChannels: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
    });
    await expect(repository.listForUser('alice')).resolves.toHaveLength(1);
  });

  it('registers inbox on the shared dispatcher singleton', () => {
    expect(
      notificationDispatcher.getChannels().some((channel) => channel.name === 'inbox'),
    ).toBe(true);
  });
});
