// Phase 2 compatibility adapter: existing code still emits NotificationMessage
// until the scheduler is decoupled in the next phase.  These helpers translate
// legacy messages to domain events and translate events back to legacy messages
// for the existing inbox and WeChat Work send implementations.

import {
  NotificationEventType,
  NotificationMessageType,
  type NotificationEvent,
  type NotificationMessage,
} from './notification-types';

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

export function notificationMessageTypeToEventType(
  type: NotificationMessageType,
): string {
  if (type === NotificationMessageType.WATCHING_UPDATE_FOUND) {
    return NotificationEventType.WATCHING_UPDATE_FOUND;
  }
  if (type === NotificationMessageType.WATCHING_UPDATE_FAILED) {
    return NotificationEventType.WATCHING_UPDATE_FAILED;
  }
  return NotificationEventType.SYSTEM_ERROR;
}

export function notificationMessageToEvent(
  message: NotificationMessage,
  createId: () => string,
): NotificationEvent {
  return {
    id: createId(),
    type: notificationMessageTypeToEventType(message.type),
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

export function notificationEventToMessage(
  event: NotificationEvent,
): NotificationMessage {
  const title = stringValue(event.data.title, getDefaultEventTitle(event));
  const content = stringValue(
    event.data.content,
    getDefaultEventContent(event),
  );
  return {
    userId: event.userId ?? '',
    type: eventTypeToMessageType(event.type),
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

function eventTypeToMessageType(type: string): NotificationMessageType {
  if (type === NotificationEventType.WATCHING_UPDATE_FOUND) {
    return NotificationMessageType.WATCHING_UPDATE_FOUND;
  }
  if (type === NotificationEventType.WATCHING_UPDATE_FAILED) {
    return NotificationMessageType.WATCHING_UPDATE_FAILED;
  }
  return NotificationMessageType.SYSTEM;
}

function getDefaultEventTitle(event: NotificationEvent): string {
  if (event.type === NotificationEventType.WATCHING_UPDATE_FOUND) {
    return '\u8ffd\u66f4\u53d1\u73b0\u66f4\u65b0';
  }
  if (event.type === NotificationEventType.WATCHING_UPDATE_FAILED) {
    return '\u8ffd\u66f4\u68c0\u67e5\u5931\u8d25';
  }
  if (event.type === NotificationEventType.SCHEDULER_FAILED) {
    return '\u8ba1\u5212\u4efb\u52a1\u5931\u8d25';
  }
  return '\u7cfb\u7edf\u901a\u77e5';
}

function getDefaultEventContent(event: NotificationEvent): string {
  if (event.type === NotificationEventType.WATCHING_UPDATE_FOUND) {
    const source = stringValue(
      event.data.sourceName,
      stringValue(event.data.source, '-'),
    );
    const episode = stringValue(
      event.data.latestEpisode,
      stringValue(event.data.episode, '-'),
    );
    return `${source} \u5df2\u53d1\u73b0\u66f4\u65b0\uff0c\u6700\u65b0\u96c6\u6570\uff1a${episode}`;
  }
  if (event.type === NotificationEventType.WATCHING_UPDATE_FAILED) {
    return stringValue(
      event.data.error,
      '\u8ffd\u66f4\u68c0\u67e5\u5931\u8d25',
    );
  }
  return stringValue(
    event.data.message,
    stringValue(
      event.data.displayTime,
      `\u4e8b\u4ef6 ${event.type} \u5df2\u53d1\u751f`,
    ),
  );
}
