import {
  NotificationEventType,
  NotificationMessageType,
  type NotificationEvent,
  type NotificationMessage,
  type NotificationPayload,
} from './notification-types';

/**
 * @deprecated New code should create NotificationPayload directly.
 */
export function notificationMessageTypeToEventType(
  type: NotificationMessageType,
): string {
  return type === NotificationMessageType.SYSTEM
    ? NotificationEventType.SYSTEM_ERROR
    : String(type).toLowerCase();
}

/**
 * @deprecated New code should create NotificationPayload directly.
 */
export function notificationMessageToEvent(
  message: NotificationMessage,
  createId: () => string,
): NotificationEvent {
  return {
    id: createId(),
    type: notificationMessageTypeToEventType(
      message.type as NotificationMessageType,
    ),
    userId: message.userId,
    createdAt: message.createdAt,
    data: {
      title: message.title,
      content: message.content,
      messageType: message.type,
      ...(message.payload ?? {}),
    },
  };
}

/**
 * @deprecated New code should dispatch NotificationPayload directly.
 */
export function notificationMessageToPayload(
  message: NotificationMessage,
  createId: () => string,
): NotificationPayload {
  return {
    id: createId(),
    type: notificationMessageTypeToEventType(
      message.type as NotificationMessageType,
    ),
    targetUser: message.userId,
    occurredAt: message.createdAt,
    data: {
      title: message.title,
      content: message.content,
      messageType: message.type,
      ...(message.payload ?? {}),
    },
    metadata: message.metadata,
  };
}

/**
 * @deprecated New code should dispatch NotificationPayload directly.
 */
export function notificationEventToPayload(
  event: NotificationEvent,
): NotificationPayload {
  return {
    id: event.id,
    type: event.type,
    targetUser: event.userId,
    occurredAt: event.createdAt,
    data: { ...event.data },
  };
}

/**
 * @deprecated New code should not convert payloads back into legacy events.
 */
export function notificationPayloadToEvent(
  payload: NotificationPayload,
  createId: () => string,
): NotificationEvent {
  const occurredAt =
    typeof payload.occurredAt === 'number' &&
    Number.isFinite(payload.occurredAt)
      ? payload.occurredAt
      : Date.now();
  return {
    id: payload.id || createId(),
    type: payload.type,
    userId: payload.targetUser,
    createdAt: occurredAt,
    data: {
      ...payload.data,
      ...(payload.metadata ? { metadata: payload.metadata } : {}),
    },
  };
}

/**
 * @deprecated New code should build NotificationMessage through a Builder.
 */
export function notificationEventToMessage(
  event: NotificationEvent,
): NotificationMessage {
  const title =
    typeof event.data.title === 'string' && event.data.title.trim()
      ? event.data.title.trim()
      : event.type;
  const content =
    typeof event.data.content === 'string'
      ? event.data.content
      : typeof event.data.message === 'string'
        ? event.data.message
        : '';
  return {
    userId: event.userId ?? '',
    type: event.type,
    title,
    content,
    createdAt: event.createdAt,
    payload: {
      ...event.data,
      eventId: event.id,
      eventType: event.type,
      eventCreatedAt: event.createdAt,
    },
  };
}
