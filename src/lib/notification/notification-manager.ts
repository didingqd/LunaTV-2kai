// Phase 2 notification refactor: NotificationManager is the new event entry point.
// It receives domain events, asks the settings service for enabled subscribed
// channels, resolves the matching provider through the registry, and records a
// per-channel result without knowing any concrete channel implementation.

import { randomUUID } from 'crypto';

import {
  notificationBuilderRegistry,
  normalizeNotificationPayload,
  type NotificationBuilderRegistry,
} from './notification-builder';
import { notificationProviderRegistry } from './notification-provider-bootstrap';
import {
  notificationSendLogRepository,
  type NotificationSendLogRepository,
} from './notification-log-repository';
import type { NotificationProviderRegistry } from './notification-provider-registry';
import {
  sanitizeNotificationErrorMessage,
  sendProviderWithRetry,
  shouldSkipDuplicateNotificationEvent,
} from './notification-send-control';
import {
  notificationSettingsService,
  type NotificationManagerSettingsService,
} from './notification-settings-service';
import type {
  NotificationDispatchError,
  NotificationDispatchResult,
  NotificationEvent,
  NotificationPayload,
} from './notification-types';
import { notificationEventToPayload } from './notification-event-adapter';

function toDispatchError(
  channel: string,
  error: unknown,
): NotificationDispatchError {
  return {
    channel,
    message: sanitizeNotificationErrorMessage(error),
  };
}

interface NotificationManagerOptions {
  now?: () => number;
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  dedupeWindowMs?: number;
}

export class NotificationManager {
  constructor(
    private readonly settingsService: NotificationManagerSettingsService = notificationSettingsService,
    private readonly registry: NotificationProviderRegistry = notificationProviderRegistry,
    private readonly createId: () => string = randomUUID,
    private readonly logRepository: Pick<
      NotificationSendLogRepository,
      'append'
    > = notificationSendLogRepository,
    private readonly options: NotificationManagerOptions = {},
    private readonly builders: Pick<
      NotificationBuilderRegistry,
      'build'
    > = notificationBuilderRegistry,
  ) {}

  async emit(event: NotificationEvent): Promise<NotificationDispatchResult> {
    return this.notify(notificationEventToPayload(event));
  }

  async notify(
    payload: NotificationPayload,
  ): Promise<NotificationDispatchResult> {
    const normalizedPayload = normalizeNotificationPayload(
      payload,
      this.createId,
      this.options.now ?? Date.now,
    );
    const channels =
      await this.settingsService.getSubscribedChannelConfigs(normalizedPayload);
    const errors: NotificationDispatchError[] = [];
    let succeeded = 0;
    const now = this.options.now ?? Date.now;
    const dedupeWindowMs = this.options.dedupeWindowMs;
    const duplicateEvent = shouldSkipDuplicateNotificationEvent(
      normalizedPayload,
      now(),
      dedupeWindowMs,
    );
    const message = await this.builders.build(normalizedPayload);

    for (const channel of channels) {
      const provider = this.registry.get(channel.type);
      const capabilities = this.registry.getCapabilities(channel.type);
      if (!provider) {
        errors.push({
          channel: channel.name,
          message: `Unsupported notification provider: ${channel.type}`,
        });
        await this.recordLog(normalizedPayload.type, channel, 'failed', {
          message: `Unsupported notification provider: ${channel.type}`,
        });
        continue;
      }
      if (capabilities?.canSend === false) {
        await this.recordLog(normalizedPayload.type, channel, 'skipped');
        continue;
      }
      if (duplicateEvent) {
        await this.recordLog(normalizedPayload.type, channel, 'skipped', {
          message: 'Duplicate notification event skipped',
        });
        continue;
      }

      try {
        await sendProviderWithRetry(provider, message, channel, {
          maxAttempts: this.options.maxAttempts,
          retryDelayMs: this.options.retryDelayMs,
          timeoutMs: this.options.timeoutMs,
        });
        succeeded += 1;
        await this.recordLog(normalizedPayload.type, channel, 'success');
      } catch (error) {
        errors.push(toDispatchError(channel.name, error));
        await this.recordLog(normalizedPayload.type, channel, 'failed', error);
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

  private async recordLog(
    eventType: string,
    channel: { id: string; type: string },
    status: 'success' | 'failed' | 'skipped',
    error?: unknown,
  ): Promise<void> {
    try {
      await this.logRepository.append({
        eventType,
        channelId: channel.id,
        providerType: channel.type,
        status,
        ...(error ? { error: sanitizeNotificationErrorMessage(error) } : {}),
        createdAt: (this.options.now ?? Date.now)(),
      });
    } catch (logError) {
      console.warn('Failed to write notification send log', logError);
    }
  }
}

export const notificationManager = new NotificationManager();
