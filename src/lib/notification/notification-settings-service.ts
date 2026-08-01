// Phase 2 settings service role: channel validation and public masking are now
// delegated to NotificationProvider instances resolved through the registry.
import { randomUUID } from 'crypto';

import { notificationProviderRegistry } from './notification-provider-bootstrap';
import type { NotificationProviderRegistry } from './notification-provider-registry';
import {
  NotificationChannelType,
  getDefaultSubscribedEvents,
  notificationSettingsRepository,
  type NormalizedUserNotificationSettings,
  type NotificationSubscription,
  type NotificationSettingsRepositoryContract,
  type UserNotificationChannelConfig,
  type UserNotificationSettings,
} from './notification-settings-repository';
import type {
  NotificationMessage,
  NotificationPayload,
} from './notification-types';

export interface NotificationManagerSettingsService {
  getSubscribedChannelConfigs(
    notification: NotificationPayload,
  ): Promise<UserNotificationChannelConfig[]>;
}

function normalizeSubscribedEvents(value: unknown): string[] {
  if (!Array.isArray(value)) return getDefaultSubscribedEvents();
  return Array.from(
    new Set(
      value
        .map((event) => (typeof event === 'string' ? event.trim() : ''))
        .filter(Boolean),
    ),
  );
}

function applySubscriptions(
  channels: UserNotificationChannelConfig[],
  subscriptions: NotificationSubscription[] | undefined,
): UserNotificationChannelConfig[] {
  if (!Array.isArray(subscriptions)) return channels;
  return channels.map((channel) => {
    const events = new Set(channel.subscribedEvents);
    for (const subscription of subscriptions) {
      const eventType = subscription.eventType.trim();
      if (!eventType) continue;
      const targets = new Set(subscription.channels);
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

export class NotificationSettingsService implements NotificationManagerSettingsService {
  constructor(
    private readonly repository: NotificationSettingsRepositoryContract = notificationSettingsRepository,
    private readonly now: () => number = Date.now,
    private readonly registry: NotificationProviderRegistry = notificationProviderRegistry,
  ) {}

  async getForUser(
    userId: string,
  ): Promise<NormalizedUserNotificationSettings> {
    return this.repository.getForUser(userId);
  }

  async save(
    userId: string,
    settings: UserNotificationSettings,
  ): Promise<NormalizedUserNotificationSettings> {
    const current = await this.repository.getForUser(userId);
    const nextNotificationCenterEnabled =
      typeof settings.notificationCenterEnabled === 'boolean'
        ? settings.notificationCenterEnabled
        : current.notificationCenterEnabled;
    const nextInboxEnabled =
      typeof settings.inboxEnabled === 'boolean'
        ? settings.inboxEnabled
        : current.inboxEnabled;
    let channels = current.channels.map((channel) => ({
      ...channel,
      subscribedEvents: [...channel.subscribedEvents],
      config: { ...channel.config },
    }));

    channels = applySubscriptions(channels, settings.subscriptions);

    channels = channels.map((channel) =>
      channel.type === NotificationChannelType.INBOX
        ? { ...channel, enabled: nextInboxEnabled }
        : channel,
    );

    return this.repository.save(userId, {
      version: 2,
      ...current,
      ...settings,
      notificationCenterEnabled: nextNotificationCenterEnabled,
      inboxEnabled: nextInboxEnabled,
      channels,
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
    if (!settings.notificationCenterEnabled) return false;

    return settings.channels.some(
      (channel) =>
        channel.enabled && channel.subscribedEvents.includes(message.type),
    );
  }

  async getSubscribedChannelConfigs(
    notification: NotificationPayload,
  ): Promise<UserNotificationChannelConfig[]> {
    const userId = notification.targetUser;
    if (!userId) return [];
    const settings = await this.repository.getForUser(userId);
    if (!settings.notificationCenterEnabled) return [];
    return settings.channels.filter(
      (channel) =>
        channel.enabled && channel.subscribedEvents.includes(notification.type),
    );
  }

  async getEnabledChannelConfigsForUser(
    userId: string,
  ): Promise<UserNotificationChannelConfig[]> {
    const settings = await this.repository.getForUser(userId);
    if (!settings.notificationCenterEnabled) return [];
    return settings.channels.filter((channel) => channel.enabled);
  }

  async createChannel(
    userId: string,
    input: {
      type: string;
      name?: string;
      subscribedEvents?: string[];
      config?: Record<string, unknown>;
    },
  ): Promise<NormalizedUserNotificationSettings> {
    const current = await this.repository.getForUser(userId);
    const channel = this.normalizeChannelInput({
      id: randomUUID(),
      type: input.type,
      name: input.name,
      enabled: true,
      subscribedEvents: input.subscribedEvents,
      config: input.config,
    });

    if (channel.type === NotificationChannelType.INBOX) {
      throw new Error('UNSUPPORTED_NOTIFICATION_CHANNEL_TYPE');
    }

    return this.repository.save(userId, {
      version: 2,
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
      subscribedEvents?: string[];
      config?: Record<string, unknown>;
    },
  ): Promise<NormalizedUserNotificationSettings> {
    const current = await this.repository.getForUser(userId);
    const existing = current.channels.find(
      (channel) => channel.id === channelId,
    );
    if (!existing) throw new Error('NOTIFICATION_CHANNEL_NOT_FOUND');
    if (existing.type === NotificationChannelType.INBOX && patch.config) {
      throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    }

    const next = this.normalizeChannelInput({
      ...existing,
      ...patch,
      config: patch.config
        ? { ...existing.config, ...patch.config }
        : existing.config,
      subscribedEvents: patch.subscribedEvents ?? existing.subscribedEvents,
    });

    const channels = current.channels.map((channel) =>
      channel.id === channelId ? next : channel,
    );
    return this.repository.save(userId, {
      version: 2,
      ...current,
      inboxEnabled:
        next.type === NotificationChannelType.INBOX
          ? next.enabled
          : current.inboxEnabled,
      channels,
      updatedAt: this.now(),
    });
  }

  async deleteChannel(
    userId: string,
    channelId: string,
  ): Promise<NormalizedUserNotificationSettings> {
    const current = await this.repository.getForUser(userId);
    const existing = current.channels.find(
      (channel) => channel.id === channelId,
    );
    if (!existing) throw new Error('NOTIFICATION_CHANNEL_NOT_FOUND');
    if (existing.type === NotificationChannelType.INBOX) {
      throw new Error('BUILTIN_NOTIFICATION_CHANNEL');
    }

    return this.repository.save(userId, {
      version: 2,
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
        subscribedEvents: [...channel.subscribedEvents],
        config: this.registry
          .get(channel.type)
          ?.maskConfig?.(channel.config) ?? { ...channel.config },
      })),
    };
  }

  private normalizeChannelInput(input: {
    id: string;
    type: string;
    name?: string;
    enabled: boolean;
    subscribedEvents?: string[];
    config?: Record<string, unknown>;
  }): UserNotificationChannelConfig {
    // Provider-owned validation prevents this service from gaining per-type branches.
    const provider = this.registry.get(input.type);
    if (!provider) throw new Error('UNSUPPORTED_NOTIFICATION_CHANNEL_TYPE');
    const config = provider.validateConfig(input.config ?? {});

    return {
      id: input.id,
      type: input.type,
      name: input.name?.trim() || provider.getDisplayName(),
      enabled: input.enabled,
      subscribedEvents: normalizeSubscribedEvents(input.subscribedEvents),
      config,
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
