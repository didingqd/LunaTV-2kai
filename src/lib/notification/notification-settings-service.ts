import { randomUUID } from 'crypto';

import {
  NotificationChannelType,
  notificationSettingsRepository,
  type NormalizedUserNotificationSettings,
  type NotificationSettingsRepositoryContract,
  type UserNotificationChannelConfig,
  type UserNotificationSettings,
} from './notification-settings-repository';
import {
  NotificationMessageType,
  type NotificationMessage,
} from './notification-types';

export class NotificationSettingsService {
  constructor(
    private readonly repository: NotificationSettingsRepositoryContract = notificationSettingsRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async getForUser(userId: string): Promise<NormalizedUserNotificationSettings> {
    return this.repository.getForUser(userId);
  }

  async save(
    userId: string,
    settings: UserNotificationSettings,
  ): Promise<NormalizedUserNotificationSettings> {
    const current = await this.repository.getForUser(userId);
    const nextInboxEnabled =
      typeof settings.inboxEnabled === 'boolean'
        ? settings.inboxEnabled
        : current.inboxEnabled;
    return this.repository.save(userId, {
      ...current,
      ...settings,
      inboxEnabled: nextInboxEnabled,
      channels: current.channels.map((channel) =>
        channel.type === NotificationChannelType.INBOX
          ? { ...channel, enabled: nextInboxEnabled }
          : channel,
      ),
      updatedAt: this.now(),
    });
  }

  async restoreDefault(
    userId: string,
  ): Promise<NormalizedUserNotificationSettings> {
    await this.repository.delete(userId);
    return this.repository.getForUser(userId);
  }

  async shouldDispatch(message: NotificationMessage): Promise<boolean> {
    const settings = await this.repository.getForUser(message.userId);

    if (
      message.type === NotificationMessageType.WATCHING_UPDATE_FOUND &&
      !settings.watchingUpdateFoundEnabled
    ) {
      return false;
    }

    if (
      message.type === NotificationMessageType.WATCHING_UPDATE_FAILED &&
      !settings.watchingUpdateFailedEnabled
    ) {
      return false;
    }

    return true;
  }

  async getEnabledChannelConfigsForUser(
    userId: string,
  ): Promise<UserNotificationChannelConfig[]> {
    const settings = await this.repository.getForUser(userId);
    return settings.channels.filter((channel) => channel.enabled);
  }

  async createChannel(
    userId: string,
    input: {
      type: string;
      name?: string;
      config?: Record<string, unknown>;
    },
  ): Promise<NormalizedUserNotificationSettings> {
    const current = await this.repository.getForUser(userId);
    const channel = this.normalizeChannelInput({
      id: randomUUID(),
      type: input.type,
      name: input.name,
      enabled: true,
      config: input.config,
    });

    if (channel.type === NotificationChannelType.INBOX) {
      throw new Error('UNSUPPORTED_NOTIFICATION_CHANNEL_TYPE');
    }

    return this.repository.save(userId, {
      ...current,
      channels: [...current.channels, channel],
      updatedAt: this.now(),
    });
  }

  async updateChannel(
    userId: string,
    channelId: string,
    patch: {
      enabled?: boolean;
      name?: string;
      config?: Record<string, unknown>;
    },
  ): Promise<NormalizedUserNotificationSettings> {
    const current = await this.repository.getForUser(userId);
    const existing = current.channels.find((channel) => channel.id === channelId);
    if (!existing) throw new Error('NOTIFICATION_CHANNEL_NOT_FOUND');
    if (existing.type === NotificationChannelType.INBOX) {
      const enabled =
        typeof patch.enabled === 'boolean' ? patch.enabled : existing.enabled;
      return this.repository.save(userId, {
        ...current,
        inboxEnabled: enabled,
        channels: current.channels.map((channel) =>
          channel.id === channelId ? { ...channel, enabled } : channel,
        ),
        updatedAt: this.now(),
      });
    }

    const next = this.normalizeChannelInput({
      ...existing,
      ...patch,
      config: patch.config ? { ...existing.config, ...patch.config } : existing.config,
    });

    return this.repository.save(userId, {
      ...current,
      channels: current.channels.map((channel) =>
        channel.id === channelId ? next : channel,
      ),
      updatedAt: this.now(),
    });
  }

  async deleteChannel(
    userId: string,
    channelId: string,
  ): Promise<NormalizedUserNotificationSettings> {
    const current = await this.repository.getForUser(userId);
    const existing = current.channels.find((channel) => channel.id === channelId);
    if (!existing) throw new Error('NOTIFICATION_CHANNEL_NOT_FOUND');
    if (existing.type === NotificationChannelType.INBOX) {
      throw new Error('BUILTIN_NOTIFICATION_CHANNEL');
    }

    return this.repository.save(userId, {
      ...current,
      channels: current.channels.filter((channel) => channel.id !== channelId),
      updatedAt: this.now(),
    });
  }

  toPublicSettings(
    settings: NormalizedUserNotificationSettings,
  ): NormalizedUserNotificationSettings {
    return {
      ...settings,
      channels: settings.channels.map((channel) => ({
        ...channel,
        config: this.maskChannelConfig(channel.type, channel.config),
      })),
    };
  }

  private normalizeChannelInput(
    input: {
      id: string;
      type: string;
      name?: string;
      enabled: boolean;
      config?: Record<string, unknown>;
    },
  ): UserNotificationChannelConfig {
    if (input.type !== NotificationChannelType.WECHAT_WORK) {
      throw new Error('UNSUPPORTED_NOTIFICATION_CHANNEL_TYPE');
    }

    const webhookUrl =
      typeof input.config?.webhookUrl === 'string'
        ? input.config.webhookUrl.trim()
        : '';
    if (!webhookUrl) throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    try {
      const url = new URL(webhookUrl);
      if (url.protocol !== 'https:') {
        throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
      }
    } catch {
      throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    }

    return {
      id: input.id,
      type: NotificationChannelType.WECHAT_WORK,
      name: input.name?.trim() || '企业微信',
      enabled: input.enabled,
      config: {
        webhookUrl,
      },
    };
  }

  private maskChannelConfig(
    type: string,
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    if (type !== NotificationChannelType.WECHAT_WORK) return { ...config };
    const webhookUrl =
      typeof config.webhookUrl === 'string' ? config.webhookUrl : '';
    return {
      webhookUrl: maskSensitiveUrl(webhookUrl),
    };
  }
}

export const notificationSettingsService = new NotificationSettingsService(
  notificationSettingsRepository,
);

export function maskSensitiveUrl(value: string): string {
  if (!value) return '';
  const suffix = value.slice(-4);
  try {
    const url = new URL(value);
    return `${url.origin}/****${suffix}`;
  } catch {
    return `****${suffix}`;
  }
}
