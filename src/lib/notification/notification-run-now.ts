import { randomUUID } from 'crypto';

import { NOTIFICATION_TEST_EVENT_TYPE } from '../notification-test-event';
import type { NotificationPayload } from './notification-types';
import { timezoneService } from '../services/timezone_service';

export const NOTIFICATION_RUN_NOW_EVENT_TYPES = [
  NOTIFICATION_TEST_EVENT_TYPE,
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

export function createNotificationRunNowPayload(
  userId: string,
  eventType: NotificationRunNowEventType,
  now: () => number = Date.now,
  createId: () => string = randomUUID,
  timezone = 'UTC',
): NotificationPayload {
  const timestamp = now();
  const displayTime = timezoneService.format(timestamp, timezone);
  const message =
    '\u8fd9\u662f Run Now \u751f\u6210\u7684\u6d4b\u8bd5\u901a\u77e5';

  return {
    id: createId(),
    type: eventType,
    targetUser: userId,
    occurredAt: timestamp,
    data: {
      title: '\u6d4b\u8bd5\u901a\u77e5',
      message,
      content: message,
      source: 'notification-debug',
      timestamp,
      displayTime,
    },
    metadata: {
      debug: true,
      timezone,
      displayTime,
    },
  };
}
