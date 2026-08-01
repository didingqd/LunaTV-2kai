// Phase 2 storage migration note: the cache key remains v1 for compatibility,
// but normalized data is written with version: 2 and per-channel subscribedEvents.
// Legacy global switches are still read and mirrored so old clients keep working
// while new code can use the channel subscription model.
import { db } from '@/lib/db';

import { notificationEventRegistry } from './notification-event-registry';

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
  subscriptions?: NotificationSubscription[];
  channels?: UserNotificationChannelInput[];
  updatedAt?: number;
}

export interface NotificationSubscription {
  eventType: string;
  enabled: boolean;
  channels: string[];
}

export interface NormalizedUserNotificationSettings {
  version: 2;
  notificationCenterEnabled: boolean;
  inboxEnabled: boolean;
  subscriptions: NotificationSubscription[];
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

export function getDefaultSubscribedEvents(): string[] {
  return notificationEventRegistry.defaultSubscribedEvents();
}

export function getDefaultNotificationSettings(): NormalizedUserNotificationSettings {
  const subscribedEvents = getDefaultSubscribedEvents();
  const channels: UserNotificationChannelConfig[] = [
    {
      id: 'inbox',
      type: NotificationChannelType.INBOX,
      name: '\u7ad9\u5185\u901a\u77e5',
      enabled: true,
      subscribedEvents,
      config: {},
    },
  ];
  return {
    version: 2,
    notificationCenterEnabled: true,
    inboxEnabled: true,
    subscriptions: buildSubscriptions(channels),
    channels,
  };
}

export const DEFAULT_NOTIFICATION_SETTINGS = getDefaultNotificationSettings();

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
  fallback: string[],
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

  return [...fallback];
}

function normalizeChannel(
  value: unknown,
  fallbackSubscribedEvents: string[],
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
      fallbackSubscribedEvents,
    ),
    config: copyConfig(channel.config),
  };
}

function normalizeChannels(
  value: unknown,
  inboxEnabled: boolean,
  fallbackSubscribedEvents: string[],
): UserNotificationChannelConfig[] {
  const customChannels = Array.isArray(value)
    ? value
        .map((item) => normalizeChannel(item, fallbackSubscribedEvents))
        .filter(
          (channel): channel is UserNotificationChannelConfig =>
            Boolean(channel) && channel.type !== NotificationChannelType.INBOX,
        )
    : [];

  const explicitInbox = Array.isArray(value)
    ? value
        .map((item) => normalizeChannel(item, fallbackSubscribedEvents))
        .find((channel) => channel?.type === NotificationChannelType.INBOX)
    : null;

  return [
    {
      id: 'inbox',
      type: NotificationChannelType.INBOX,
      name: explicitInbox?.name ?? '\u7ad9\u5185\u901a\u77e5',
      enabled: explicitInbox?.enabled ?? inboxEnabled,
      subscribedEvents: explicitInbox?.subscribedEvents ?? [
        ...fallbackSubscribedEvents,
      ],
      config: {},
    },
    ...customChannels,
  ];
}

function applyLegacySubscriptionPatches(
  fallbackSubscribedEvents: string[],
  settings: Record<string, unknown>,
): string[] {
  const events = new Set(fallbackSubscribedEvents);
  for (const patch of notificationEventRegistry.readLegacySubscriptionPatches(
    settings,
  )) {
    if (patch.enabled) events.add(patch.eventType);
    else events.delete(patch.eventType);
  }
  return Array.from(events);
}

function buildSubscriptions(
  channels: UserNotificationChannelConfig[],
): NotificationSubscription[] {
  const eventTypes = Array.from(
    new Set(channels.flatMap((channel) => channel.subscribedEvents)),
  );
  return eventTypes.map((eventType) => {
    const subscribedChannels = channels
      .filter(
        (channel) =>
          channel.enabled && channel.subscribedEvents.includes(eventType),
      )
      .map((channel) => channel.id);
    return {
      eventType,
      enabled: subscribedChannels.length > 0,
      channels: subscribedChannels,
    };
  });
}

function applySubscriptions(
  channels: UserNotificationChannelConfig[],
  subscriptions: NotificationSubscription[] | undefined,
): UserNotificationChannelConfig[] {
  if (!Array.isArray(subscriptions)) return channels;
  return channels.map((channel) => {
    const events = new Set(channel.subscribedEvents);
    for (const subscription of subscriptions) {
      const eventType =
        typeof subscription.eventType === 'string'
          ? subscription.eventType.trim()
          : '';
      if (!eventType) continue;
      const targets = Array.isArray(subscription.channels)
        ? new Set(subscription.channels)
        : new Set<string>();
      if (subscription.enabled && targets.has(channel.id)) {
        events.add(eventType);
      } else if (!subscription.enabled || targets.has(channel.id)) {
        events.delete(eventType);
      }
    }
    return {
      ...channel,
      subscribedEvents: Array.from(events),
    };
  });
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
      const defaults = getDefaultNotificationSettings();
      return {
        ...defaults,
        channels: defaults.channels.map((channel) => ({
          ...channel,
          subscribedEvents: [...channel.subscribedEvents],
          config: { ...channel.config },
        })),
      };
    }

    const settings = value as UserNotificationSettings;
    const notificationCenterEnabled = booleanOrDefault(
      settings.notificationCenterEnabled,
      true,
    );
    const inboxEnabled = booleanOrDefault(settings.inboxEnabled, true);
    const fallbackSubscribedEvents = applyLegacySubscriptionPatches(
      getDefaultSubscribedEvents(),
      settings as Record<string, unknown>,
    );
    const channels = applySubscriptions(
      normalizeChannels(
        settings.channels,
        inboxEnabled,
        fallbackSubscribedEvents,
      ),
      settings.subscriptions,
    );
    return {
      version: 2,
      notificationCenterEnabled,
      inboxEnabled,
      subscriptions: buildSubscriptions(channels),
      channels,
      ...(typeof settings.updatedAt === 'number'
        ? { updatedAt: settings.updatedAt }
        : {}),
    };
  }
}

export const notificationSettingsRepository =
  new NotificationSettingsRepository();
