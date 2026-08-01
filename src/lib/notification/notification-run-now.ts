import { randomUUID } from 'crypto';

import {
  NotificationEventType,
  type NotificationEvent,
} from './notification-types';

export const NOTIFICATION_RUN_NOW_EVENT_TYPES = [
  NotificationEventType.WATCHING_UPDATE_FOUND,
  NotificationEventType.WATCHING_UPDATE_FAILED,
  NotificationEventType.SCHEDULER_FAILED,
  NotificationEventType.SYSTEM_ERROR,
] as const;

export type NotificationRunNowEventType =
  (typeof NOTIFICATION_RUN_NOW_EVENT_TYPES)[number];

export function isNotificationRunNowEventType(
  value: string,
): value is NotificationRunNowEventType {
  return NOTIFICATION_RUN_NOW_EVENT_TYPES.some(
    (eventType) => eventType === value,
  );
}

export function createNotificationRunNowEvent(
  userId: string,
  eventType: NotificationRunNowEventType,
  now: () => number = Date.now,
  createId: () => string = randomUUID,
): NotificationEvent {
  const timestamp = now();
  const message =
    '\u8fd9\u662f Run Now \u751f\u6210\u7684\u6d4b\u8bd5\u901a\u77e5';

  return {
    id: createId(),
    type: eventType,
    userId,
    data: {
      title: '\u6d4b\u8bd5\u66f4\u65b0\u901a\u77e5',
      message,
      content: message,
      source: 'notification-debug',
      metadata: {
        debug: true,
      },
      timestamp,
    },
    createdAt: timestamp,
  };
}
