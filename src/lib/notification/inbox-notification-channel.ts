import { randomUUID } from 'crypto';

import type { NotificationChannel } from './notification-channel';
import {
  InboxNotificationRepository,
  inboxNotificationRepository,
  type InboxNotificationRepositoryContract,
} from './inbox-notification-repository';
import type { InboxNotification, NotificationMessage } from './notification-types';

function toInboxNotification(
  message: NotificationMessage,
  createId: () => string,
): InboxNotification {
  return {
    id: createId(),
    userId: message.userId,
    type: message.type,
    title: message.title,
    content: message.content,
    payload: message.payload ? { ...message.payload } : undefined,
    createdAt: message.createdAt,
    read: false,
    readAt: null,
  };
}

export class InboxNotificationChannel implements NotificationChannel {
  readonly name = 'inbox';

  constructor(
    private readonly repository: InboxNotificationRepositoryContract = inboxNotificationRepository,
    private readonly createId: () => string = randomUUID,
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    await this.repository.append(
      message.userId,
      toInboxNotification(message, this.createId),
    );
  }
}

export const inboxNotificationChannel = new InboxNotificationChannel(
  inboxNotificationRepository,
);
