import { randomUUID } from 'crypto';

import type {
  NotificationLevel,
  NotificationMessage,
  NotificationPayload,
} from './notification-types';

export interface NotificationBuilder<
  TPayload extends NotificationPayload = NotificationPayload,
> {
  build(payload: TPayload): NotificationMessage | Promise<NotificationMessage>;
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function levelValue(value: unknown): NotificationLevel | undefined {
  return value === 'info' ||
    value === 'success' ||
    value === 'warning' ||
    value === 'error'
    ? value
    : undefined;
}

function copyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function normalizeNotificationPayload(
  payload: NotificationPayload,
  createId: () => string = randomUUID,
  now: () => number = Date.now,
): Required<Pick<NotificationPayload, 'id' | 'type' | 'data'>> &
  Omit<NotificationPayload, 'id' | 'data'> {
  return {
    ...payload,
    id: payload.id || createId(),
    data: copyRecord(payload.data),
    ...(payload.metadata ? { metadata: copyRecord(payload.metadata) } : {}),
    occurredAt:
      typeof payload.occurredAt === 'number' &&
      Number.isFinite(payload.occurredAt)
        ? payload.occurredAt
        : now(),
  };
}

export class DefaultNotificationBuilder implements NotificationBuilder<NotificationPayload> {
  build(payload: NotificationPayload): NotificationMessage {
    const occurredAt =
      typeof payload.occurredAt === 'number' &&
      Number.isFinite(payload.occurredAt)
        ? payload.occurredAt
        : Date.now();
    const content = stringValue(
      payload.data.content,
      stringValue(payload.data.body, stringValue(payload.data.message)),
    );

    return {
      userId: payload.targetUser ?? '',
      type: payload.type,
      title: stringValue(payload.data.title, payload.type),
      body: content,
      content,
      level: levelValue(payload.data.level ?? payload.metadata?.level),
      createdAt: occurredAt,
      payload: {
        ...payload.data,
        ...(payload.metadata ? { metadata: payload.metadata } : {}),
        payloadId: payload.id,
        eventType: payload.type,
        eventCreatedAt: occurredAt,
      },
      metadata: payload.metadata ? { ...payload.metadata } : undefined,
    };
  }
}

export class NotificationBuilderRegistry {
  private readonly builders = new Map<string, NotificationBuilder>();
  private readonly fallback: NotificationBuilder;

  constructor(
    fallback: NotificationBuilder = new DefaultNotificationBuilder(),
  ) {
    this.fallback = fallback;
  }

  register(type: string, builder: NotificationBuilder): void {
    const key = type.trim();
    if (!key) throw new Error('INVALID_NOTIFICATION_PAYLOAD_TYPE');
    this.builders.set(key, builder);
  }

  unregister(type: string): void {
    this.builders.delete(type);
  }

  has(type: string): boolean {
    return this.builders.has(type);
  }

  async build(payload: NotificationPayload): Promise<NotificationMessage> {
    const builder = this.builders.get(payload.type) ?? this.fallback;
    return builder.build(payload);
  }
}

export const notificationBuilderRegistry = new NotificationBuilderRegistry();
