import {
  InboxNotificationRepository,
  inboxNotificationRepository,
  type InboxNotificationRepositoryContract,
} from './inbox-notification-repository';
import type { InboxNotification } from './notification-types';

export interface InboxNotificationListResult {
  notifications: InboxNotification[];
  total: number;
  unread: number;
}

export class InboxNotificationService {
  constructor(
    private readonly repository: InboxNotificationRepositoryContract = inboxNotificationRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async listForUser(userId: string): Promise<InboxNotificationListResult> {
    const notifications = await this.repository.listForUser(userId);
    return {
      notifications,
      total: notifications.length,
      unread: notifications.filter((notification) => !notification.read).length,
    };
  }

  async markRead(
    userId: string,
    id: string,
    read: boolean,
  ): Promise<InboxNotification> {
    const updated = await this.repository.markRead(
      userId,
      id,
      read,
      read ? this.now() : null,
    );
    if (!updated) throw new Error('NOTIFICATION_NOT_FOUND');
    return updated;
  }

  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(userId, id);
    if (!deleted) throw new Error('NOTIFICATION_NOT_FOUND');
  }

  async clearForUser(userId: string): Promise<void> {
    await this.repository.clearForUser(userId);
  }
}

export const inboxNotificationService = new InboxNotificationService(
  inboxNotificationRepository,
);
