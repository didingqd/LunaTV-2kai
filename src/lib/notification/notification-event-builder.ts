import type { NotificationEvent } from './notification-types';

/**
 * @deprecated New code should create NotificationPayload directly.
 */
export function createNotificationEvent(input: {
  id: string;
  type: string;
  userId?: string;
  data: Record<string, unknown>;
  createdAt: number;
}): NotificationEvent {
  return {
    id: input.id,
    type: input.type,
    userId: input.userId,
    data: { ...input.data },
    createdAt: input.createdAt,
  };
}
