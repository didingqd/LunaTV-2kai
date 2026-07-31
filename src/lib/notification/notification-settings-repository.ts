import { db } from '@/lib/db';

export const NotificationChannelType = {
  INBOX: 'inbox',
  WECHAT_WORK: 'wechat_work',
} as const;

export type NotificationChannelType =
  (typeof NotificationChannelType)[keyof typeof NotificationChannelType];

export interface UserNotificationChannelConfig {
  id: string;
  type: NotificationChannelType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface UserNotificationSettings {
  inboxEnabled?: boolean;
  watchingUpdateFoundEnabled?: boolean;
  watchingUpdateFailedEnabled?: boolean;
  channels?: UserNotificationChannelConfig[];
  updatedAt?: number;
}

export interface NormalizedUserNotificationSettings {
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

export const DEFAULT_NOTIFICATION_SETTINGS: NormalizedUserNotificationSettings = {
  inboxEnabled: true,
  watchingUpdateFoundEnabled: true,
  watchingUpdateFailedEnabled: true,
  channels: [
    {
      id: 'inbox',
      type: NotificationChannelType.INBOX,
      name: '站内通知',
      enabled: true,
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

function isSupportedChannelType(value: unknown): value is NotificationChannelType {
  return (
    value === NotificationChannelType.INBOX ||
    value === NotificationChannelType.WECHAT_WORK
  );
}

function normalizeChannel(value: unknown): UserNotificationChannelConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const channel = value as Partial<UserNotificationChannelConfig>;
  if (!isSupportedChannelType(channel.type)) return null;
  const id = stringOrDefault(
    channel.id,
    channel.type === NotificationChannelType.INBOX ? 'inbox' : '',
  );
  if (!id) return null;

  return {
    id,
    type: channel.type,
    name: stringOrDefault(
      channel.name,
      channel.type === NotificationChannelType.INBOX ? '站内通知' : '通知方式',
    ),
    enabled: booleanOrDefault(channel.enabled, true),
    config: copyConfig(channel.config),
  };
}

function normalizeChannels(
  value: unknown,
  inboxEnabled: boolean,
): UserNotificationChannelConfig[] {
  const customChannels = Array.isArray(value)
    ? value
        .map(normalizeChannel)
        .filter(
          (channel): channel is UserNotificationChannelConfig =>
            Boolean(channel) && channel.type !== NotificationChannelType.INBOX,
        )
    : [];

  return [
    {
      id: 'inbox',
      type: NotificationChannelType.INBOX,
      name: '站内通知',
      enabled: inboxEnabled,
      config: {},
    },
    ...customChannels,
  ];
}

export class NotificationSettingsRepository
  implements NotificationSettingsRepositoryContract
{
  constructor(private readonly store: NotificationSettingsStore = db) {}

  async getForUser(userId: string): Promise<NormalizedUserNotificationSettings> {
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
      return { ...DEFAULT_NOTIFICATION_SETTINGS };
    }

    const settings = value as UserNotificationSettings;
    const inboxEnabled = booleanOrDefault(
      settings.inboxEnabled,
      DEFAULT_NOTIFICATION_SETTINGS.inboxEnabled,
    );
    return {
      inboxEnabled,
      watchingUpdateFoundEnabled: booleanOrDefault(
        settings.watchingUpdateFoundEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.watchingUpdateFoundEnabled,
      ),
      watchingUpdateFailedEnabled: booleanOrDefault(
        settings.watchingUpdateFailedEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.watchingUpdateFailedEnabled,
      ),
      channels: normalizeChannels(settings.channels, inboxEnabled),
      ...(typeof settings.updatedAt === 'number'
        ? { updatedAt: settings.updatedAt }
        : {}),
    };
  }
}

export const notificationSettingsRepository =
  new NotificationSettingsRepository();
