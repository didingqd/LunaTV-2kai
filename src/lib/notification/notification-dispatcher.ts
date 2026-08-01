// Phase 2 compatibility wrapper: NotificationDispatcher remains exported so
// current callers and tests keep working until Phase 3.  The shared singleton
// routes through NotificationManager when no legacy test channels are registered.
import { randomUUID } from 'crypto';

import type { NotificationChannel } from './notification-channel';
import {
  notificationEventToPayload,
  notificationMessageToPayload,
} from './notification-event-adapter';
import { notificationManager } from './notification-manager';
import { notificationSettingsService } from './notification-settings-service';
import type {
  UserNotificationChannelConfig,
  UserNotificationChannelInput,
} from './notification-settings-repository';
import type {
  NotificationDispatchError,
  NotificationDispatchResult,
  NotificationEvent,
  NotificationMessage,
  NotificationPayload,
} from './notification-types';

interface NotificationDispatchSettingsService {
  shouldDispatch(message: NotificationMessage): Promise<boolean>;
  getEnabledChannelConfigsForUser?(
    userId: string,
  ): Promise<UserNotificationChannelInput[]>;
}

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

export class NotificationDispatcher {
  private readonly channels = new Map<string, NotificationChannel>();
  private readonly channelFactories = new Map<
    string,
    (config: UserNotificationChannelConfig) => NotificationChannel
  >();

  private readonly settingsService: NotificationDispatchSettingsService;
  private readonly manager?: Pick<typeof notificationManager, 'notify'> &
    Partial<Pick<typeof notificationManager, 'emit'>>;
  private readonly createId: () => string;

  constructor(
    settingsService?: NotificationDispatchSettingsService,
    manager?: Pick<typeof notificationManager, 'notify'> &
      Partial<Pick<typeof notificationManager, 'emit'>>,
    createId: () => string = randomUUID,
  ) {
    this.settingsService = settingsService ?? notificationSettingsService;
    this.manager =
      manager ?? (settingsService ? undefined : notificationManager);
    this.createId = createId;
  }

  register(channel: NotificationChannel): void {
    this.channels.set(channel.name, channel);
  }

  registerChannelFactory(
    type: string,
    factory: (config: UserNotificationChannelConfig) => NotificationChannel,
  ): void {
    this.channelFactories.set(type, factory);
  }

  unregister(name: string): void {
    this.channels.delete(name);
  }

  getChannels(): NotificationChannel[] {
    return Array.from(this.channels.values());
  }

  async dispatch(
    message: NotificationMessage,
  ): Promise<NotificationDispatchResult> {
    if (
      this.manager &&
      this.channels.size === 0 &&
      this.channelFactories.size === 0
    ) {
      const payload = notificationMessageToPayload(message, this.createId);
      return this.manager.notify(payload);
    }

    return this.dispatchLegacyChannels(message);
  }

  async dispatchEvent(
    event: NotificationEvent,
  ): Promise<NotificationDispatchResult> {
    if (!this.manager) {
      throw new Error('NOTIFICATION_EVENT_DISPATCH_UNAVAILABLE');
    }
    return this.manager.notify(notificationEventToPayload(event));
  }

  async dispatchPayload(
    payload: NotificationPayload,
  ): Promise<NotificationDispatchResult> {
    if (!this.manager) {
      throw new Error('NOTIFICATION_PAYLOAD_DISPATCH_UNAVAILABLE');
    }
    return this.manager.notify(payload);
  }

  private async dispatchLegacyChannels(
    message: NotificationMessage,
  ): Promise<NotificationDispatchResult> {
    const channels = this.getChannels();
    const errors: NotificationDispatchError[] = [];
    let succeeded = 0;

    if (!(await this.settingsService.shouldDispatch(message))) {
      return {
        success: true,
        totalChannels: channels.length,
        succeeded: 0,
        failed: 0,
        errors: [],
      };
    }

    if (this.settingsService.getEnabledChannelConfigsForUser) {
      const configuredChannels =
        await this.settingsService.getEnabledChannelConfigsForUser(
          message.userId,
        );
      const targets = configuredChannels
        .map((config) => {
          const type = typeof config.type === 'string' ? config.type : '';
          const name = typeof config.name === 'string' ? config.name : type;
          if (!type) return null;
          const normalizedConfig = {
            id: typeof config.id === 'string' ? config.id : type,
            type,
            name,
            enabled: config.enabled !== false,
            subscribedEvents: Array.isArray(config.subscribedEvents)
              ? config.subscribedEvents
              : [],
            config: config.config ?? {},
          };
          const factory = this.channelFactories.get(type);
          if (factory) return { channel: factory(normalizedConfig), name };
          const channel = this.channels.get(type);
          if (channel) return { channel, name };
          return null;
        })
        .filter(
          (
            target,
          ): target is {
            channel: NotificationChannel;
            name: string;
          } => Boolean(target),
        );

      for (const target of targets) {
        try {
          await target.channel.send(message);
          succeeded += 1;
        } catch (error) {
          errors.push(toDispatchError(target.name, error));
        }
      }

      return {
        success: errors.length === 0,
        totalChannels: targets.length,
        succeeded,
        failed: errors.length,
        errors,
      };
    }

    for (const channel of channels) {
      try {
        await channel.send(message);
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

export const notificationDispatcher = new NotificationDispatcher();
