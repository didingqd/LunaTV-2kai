// Phase 2 notification refactor: NotificationManager is the new event entry point.
// It receives domain events, asks the settings service for enabled subscribed
// channels, resolves the matching provider through the registry, and records a
// per-channel result without knowing any concrete channel implementation.

import { randomUUID } from 'crypto';

import { notificationProviderRegistry } from './notification-provider-bootstrap';
import type { NotificationProviderRegistry } from './notification-provider-registry';
import {
  notificationSettingsService,
  type NotificationManagerSettingsService,
} from './notification-settings-service';
import type {
  NotificationDispatchError,
  NotificationDispatchResult,
  NotificationEvent,
} from './notification-types';

function toDispatchError(
  channel: string,
  error: unknown,
): NotificationDispatchError {
  if (error instanceof Error && error.message) {
    return {
      channel,
      message: error.message,
    };
  }

  return {
    channel,
    message: 'Unknown notification dispatch error',
  };
}

export class NotificationManager {
  constructor(
    private readonly settingsService: NotificationManagerSettingsService = notificationSettingsService,
    private readonly registry: NotificationProviderRegistry = notificationProviderRegistry,
    private readonly createId: () => string = randomUUID,
  ) {}

  async emit(event: NotificationEvent): Promise<NotificationDispatchResult> {
    const normalizedEvent = {
      ...event,
      id: event.id || this.createId(),
      data: { ...event.data },
    };
    const channels =
      await this.settingsService.getSubscribedChannelConfigs(normalizedEvent);
    const errors: NotificationDispatchError[] = [];
    let succeeded = 0;

    for (const channel of channels) {
      const provider = this.registry.get(channel.type);
      if (!provider) {
        errors.push({
          channel: channel.name,
          message: `Unsupported notification provider: ${channel.type}`,
        });
        continue;
      }

      try {
        await provider.send(normalizedEvent, channel);
        succeeded += 1;
      } catch (error) {
        errors.push(toDispatchError(channel.name, error));
      }
    }

    return {
      success: errors.length === 0,
      totalChannels: channels.length,
      succeeded,
      failed: errors.length,
      errors,
    };
  }
}

export const notificationManager = new NotificationManager();
