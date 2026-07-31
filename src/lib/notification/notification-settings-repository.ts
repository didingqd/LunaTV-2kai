// Phase 2 storage migration note: the cache key remains v1 for compatibility,
// but normalized data is written with version: 2 and per-channel subscribedEvents.
// Legacy global switches are still read and mirrored so old clients keep working
// while new code can use the channel subscription model.
import { db } from '@/lib/db';

import { NotificationEventType } from './notification-types';

export const NotificationChannelType = {
  INBOX: 'inbox',
  WECHAT_WORK: 'wechat_work',
} as const;

export type NotificationChannelType =
  (typeof NotificationChannelType)[keyof typeof NotificationChannelType];

export type NotificationChannel = UserNotificationChannelConfig;

export interface UserNotificationChannelConfig {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  subscribedEvents: string[];
  config: Record<string, unknown>;
}

export interface UserNotificationChannelInput {
  id?: string;
  type?: string;
  name?: string;
  enabled?: boolean;
  subscribedEvents?: string[];
  config?: Record<string, unknown>;
}

export interface UserNotificationSettings {
  version?: number;
  notificationCenterEnabled?: boolean;
  inboxEnabled?: boolean;
  watchingUpdateFoundEnabled?: boolean;
  watchingUpdateFailedEnabled?: boolean;
  channels?: UserNotificationChannelInput[];
  updatedAt?: number;
}

export interface NormalizedUserNotificationSettings {
  version: 2;
  notificationCenterEnabled: boolean;
  inboxEnabled: boolean;
  watchingUpdateFoundEnabled: boolean;
  watchingUpdateFailedEnabled: boolean;
  channels: UserNotificationChannelConfig[];
  updatedAt?: number;
}

export interface NotificationSettingsStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown, expireSeconds?: number): Promise<void>;
  deleteCache(key: string): Promise<void>;
}

export interface NotificationSettingsRepositoryContract {
  getForUser(userId: string): Promise<NormalizedUserNotificationSettings>;
  save(
    userId: string,
    settings: UserNotificationSettings,
  ): Promise<NormalizedUserNotificationSettings>;
  delete(userId: string): Promise<void>;
  normalize(value: unknown): NormalizedUserNotificationSettings;
}

export const DEFAULT_SUBSCRIBED_EVENTS = [
  NotificationEventType.WATCHING_UPDATE_FOUND,
  NotificationEventType.WATCHING_UPDATE_FAILED,
] as const;

export const DEFAULT_NOTIFICATION_SETTINGS: NormalizedUserNotificationSettings =
  {
    version: 2,
    notificationCenterEnabled: true,
    inboxEnabled: true,
    watchingUpdateFoundEnabled: true,
    watchingUpdateFailedEnabled: true,
    channels: [
      {
        id: 'inbox',
        type: NotificationChannelType.INBOX,
        name: '\u7ad9\u5185\u901a\u77e5',
        enabled: true,
        subscribedEvents: [...DEFAULT_SUBSCRIBED_EVENTS],
        config: {},
      },
    ],
  };

const SETTINGS_KEY_PREFIX = 'notification-settings:v1:user:';

function settingsKey(userId: string) {
  return `${SETTINGS_KEY_PREFIX}${userId}`;
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function copyConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return { ...(config as Record<string, unknown>) };
}

// Convert legacy global update switches into the v2 event subscription list.
function normalizeSubscribedEvents(
  value: unknown,
  legacy: {
    watchingUpdateFoundEnabled: boolean;
    watchingUpdateFailedEnabled: boolean;
  },
): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((event) => (typeof event === 'string' ? event.trim() : ''))
          .filter(Boolean),
      ),
    );
  }

  const events: string[] = [];
  if (legacy.watchingUpdateFoundEnabled) {
    events.push(NotificationEventType.WATCHING_UPDATE_FOUND);
  }
  if (legacy.watchingUpdateFailedEnabled) {
    events.push(NotificationEventType.WATCHING_UPDATE_FAILED);
  }
  return events;
}

function normalizeChannel(
  value: unknown,
  legacy: {
    watchingUpdateFoundEnabled: boolean;
    watchingUpdateFailedEnabled: boolean;
  },
): UserNotificationChannelConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const channel = value as UserNotificationChannelInput;
  const type = stringOrDefault(channel.type, '');
  if (!type) return null;
  const id = stringOrDefault(
    channel.id,
    type === NotificationChannelType.INBOX ? 'inbox' : '',
  );
  if (!id) return null;

  return {
    id,
    type,
    name: stringOrDefault(
      channel.name,
      type === NotificationChannelType.INBOX
        ? '\u7ad9\u5185\u901a\u77e5'
        : '\u901a\u77e5\u65b9\u5f0f',
    ),
    enabled: booleanOrDefault(channel.enabled, true),
    subscribedEvents: normalizeSubscribedEvents(
      channel.subscribedEvents,
      legacy,
    ),
    config: copyConfig(channel.config),
  };
}

function normalizeChannels(
  value: unknown,
  inboxEnabled: boolean,
  legacy: {
    watchingUpdateFoundEnabled: boolean;
    watchingUpdateFailedEnabled: boolean;
  },
): UserNotificationChannelConfig[] {
  const customChannels = Array.isArray(value)
    ? value
        .map((item) => normalizeChannel(item, legacy))
        .filter(
          (channel): channel is UserNotificationChannelConfig =>
            Boolean(channel) && channel.type !== NotificationChannelType.INBOX,
        )
    : [];

  const explicitInbox = Array.isArray(value)
    ? value
        .map((item) => normalizeChannel(item, legacy))
        .find((channel) => channel?.type === NotificationChannelType.INBOX)
    : null;

  return [
    {
      id: 'inbox',
      type: NotificationChannelType.INBOX,
      name: explicitInbox?.name ?? '\u7ad9\u5185\u901a\u77e5',
      enabled: explicitInbox?.enabled ?? inboxEnabled,
      subscribedEvents:
        explicitInbox?.subscribedEvents ??
        normalizeSubscribedEvents(undefined, legacy),
      config: {},
    },
    ...customChannels,
  ];
}

export class NotificationSettingsRepository implements NotificationSettingsRepositoryContract {
  constructor(private readonly store: NotificationSettingsStore = db) {}

  async getForUser(
    userId: string,
  ): Promise<NormalizedUserNotificationSettings> {
    return this.normalize(await this.store.getCache(settingsKey(userId)));
  }

  async save(
    userId: string,
    settings: UserNotificationSettings,
  ): Promise<NormalizedUserNotificationSettings> {
    const normalized = this.normalize(settings);
    await this.store.setCache(settingsKey(userId), normalized);
    return normalized;
  }

  async delete(userId: string): Promise<void> {
    await this.store.deleteCache(settingsKey(userId));
  }

  normalize(value: unknown): NormalizedUserNotificationSettings {
    if (!value || typeof value !== 'object') {
      return {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        channels: DEFAULT_NOTIFICATION_SETTINGS.channels.map((channel) => ({
          ...channel,
          subscribedEvents: [...channel.subscribedEvents],
          config: { ...channel.config },
        })),
      };
    }

    const settings = value as UserNotificationSettings;
    const notificationCenterEnabled = booleanOrDefault(
      settings.notificationCenterEnabled,
      DEFAULT_NOTIFICATION_SETTINGS.notificationCenterEnabled,
    );
    const inboxEnabled = booleanOrDefault(
      settings.inboxEnabled,
      DEFAULT_NOTIFICATION_SETTINGS.inboxEnabled,
    );
    const watchingUpdateFoundEnabled = booleanOrDefault(
      settings.watchingUpdateFoundEnabled,
      DEFAULT_NOTIFICATION_SETTINGS.watchingUpdateFoundEnabled,
    );
    const watchingUpdateFailedEnabled = booleanOrDefault(
      settings.watchingUpdateFailedEnabled,
      DEFAULT_NOTIFICATION_SETTINGS.watchingUpdateFailedEnabled,
    );
    return {
      version: 2,
      notificationCenterEnabled,
      inboxEnabled,
      watchingUpdateFoundEnabled,
      watchingUpdateFailedEnabled,
      channels: normalizeChannels(settings.channels, inboxEnabled, {
        watchingUpdateFoundEnabled,
        watchingUpdateFailedEnabled,
      }),
      ...(typeof settings.updatedAt === 'number'
        ? { updatedAt: settings.updatedAt }
        : {}),
    };
  }
}

export const notificationSettingsRepository =
  new NotificationSettingsRepository();
