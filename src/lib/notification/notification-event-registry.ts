export interface NotificationEventMeta {
  type: string;
  label: string;
  description: string;
  category?: string;
  defaultSubscribed?: boolean;
}

export interface NotificationSubscriptionPatch {
  eventType: string;
  enabled: boolean;
}

export type NotificationLegacySubscriptionReader = (
  settings: Record<string, unknown>,
) => NotificationSubscriptionPatch[];

export class NotificationEventRegistry {
  private readonly metas = new Map<string, NotificationEventMeta>();
  private readonly legacyReaders: NotificationLegacySubscriptionReader[] = [];

  register(meta: NotificationEventMeta): void {
    const type = meta.type.trim();
    if (!type) throw new Error('INVALID_NOTIFICATION_EVENT_TYPE');
    this.metas.set(type, { ...meta, type });
  }

  registerMany(metas: NotificationEventMeta[]): void {
    metas.forEach((meta) => this.register(meta));
  }

  list(): NotificationEventMeta[] {
    return Array.from(this.metas.values());
  }

  get(type: string): NotificationEventMeta | null {
    return this.metas.get(type) ?? null;
  }

  defaultSubscribedEvents(): string[] {
    return this.list()
      .filter((meta) => meta.defaultSubscribed)
      .map((meta) => meta.type);
  }

  registerLegacySubscriptionReader(
    reader: NotificationLegacySubscriptionReader,
  ): void {
    if (this.legacyReaders.includes(reader)) return;
    this.legacyReaders.push(reader);
  }

  readLegacySubscriptionPatches(
    settings: Record<string, unknown>,
  ): NotificationSubscriptionPatch[] {
    const patches = this.legacyReaders.flatMap((reader) => reader(settings));
    const normalized = new Map<string, NotificationSubscriptionPatch>();
    for (const patch of patches) {
      const eventType = patch.eventType.trim();
      if (!eventType) continue;
      normalized.set(eventType, {
        eventType,
        enabled: patch.enabled,
      });
    }
    return Array.from(normalized.values());
  }

  clearForTests(): void {
    this.metas.clear();
    this.legacyReaders.length = 0;
  }
}

export const notificationEventRegistry = new NotificationEventRegistry();

export function registerNotificationEvent(meta: NotificationEventMeta): void {
  notificationEventRegistry.register(meta);
}

export function registerNotificationEvents(
  metas: NotificationEventMeta[],
): void {
  notificationEventRegistry.registerMany(metas);
}

export function getNotificationEventMetas(): NotificationEventMeta[] {
  return notificationEventRegistry.list();
}

export function getDefaultNotificationSubscribedEvents(): string[] {
  return notificationEventRegistry.defaultSubscribedEvents();
}
