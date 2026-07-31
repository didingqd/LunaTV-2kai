import { db } from '@/lib/db';

import type { InboxNotification } from './notification-types';

export interface InboxNotificationStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown, expireSeconds?: number): Promise<void>;
  deleteCache(key: string): Promise<void>;
}

export interface InboxNotificationRepositoryContract {
  listForUser(userId: string): Promise<InboxNotification[]>;
  append(userId: string, notification: InboxNotification): Promise<void>;
  markRead(
    userId: string,
    id: string,
    read: boolean,
    readAt: number | null,
  ): Promise<InboxNotification | null>;
  delete(userId: string, id: string): Promise<boolean>;
  clearForUser(userId: string): Promise<void>;
}

const INBOX_KEY_PREFIX = 'notification:v1:user:';

function inboxKey(userId: string) {
  return `${INBOX_KEY_PREFIX}${userId}`;
}

function copyNotification(notification: InboxNotification): InboxNotification {
  return {
    ...notification,
    payload: notification.payload ? { ...notification.payload } : undefined,
  };
}

function copyNotifications(
  notifications: InboxNotification[],
): InboxNotification[] {
  return notifications.map(copyNotification);
}

function isInboxNotification(value: unknown): value is InboxNotification {
  if (!value || typeof value !== 'object') return false;
  const notification = value as InboxNotification;
  return (
    typeof notification.id === 'string' &&
    typeof notification.userId === 'string' &&
    typeof notification.type === 'string' &&
    typeof notification.title === 'string' &&
    typeof notification.content === 'string' &&
    typeof notification.createdAt === 'number' &&
    typeof notification.read === 'boolean' &&
    (typeof notification.readAt === 'number' || notification.readAt === null) &&
    (notification.payload === undefined ||
      (notification.payload !== null && typeof notification.payload === 'object'))
  );
}

function asInboxNotifications(value: unknown): InboxNotification[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isInboxNotification).map(copyNotification);
}

export class InboxNotificationRepository
  implements InboxNotificationRepositoryContract
{
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: InboxNotificationStore = db) {}

  async listForUser(userId: string): Promise<InboxNotification[]> {
    const value = await this.store.getCache(inboxKey(userId));
    return asInboxNotifications(value);
  }

  async append(userId: string, notification: InboxNotification): Promise<void> {
    await this.enqueueWrite(async () => {
      const notifications = await this.listForUser(userId);
      notifications.unshift(copyNotification(notification));
      await this.store.setCache(inboxKey(userId), notifications);
    });
  }

  async markRead(
    userId: string,
    id: string,
    read: boolean,
    readAt: number | null,
  ): Promise<InboxNotification | null> {
    return this.enqueueWrite(async () => {
      const notifications = await this.listForUser(userId);
      const next = notifications.map((notification) =>
        notification.id === id
          ? copyNotification({
              ...notification,
              read,
              readAt,
            })
          : notification,
      );
      const updated = next.find((notification) => notification.id === id) ?? null;
      if (!updated) return null;
      await this.store.setCache(inboxKey(userId), next);
      return updated;
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
      const notifications = await this.listForUser(userId);
      const next = notifications.filter((notification) => notification.id !== id);
      if (next.length === notifications.length) return false;
      if (next.length === 0) {
        await this.store.deleteCache(inboxKey(userId));
      } else {
        await this.store.setCache(inboxKey(userId), next);
      }
      return true;
    });
  }

  async clearForUser(userId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.store.deleteCache(inboxKey(userId));
    });
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(operation);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export const inboxNotificationRepository = new InboxNotificationRepository();
