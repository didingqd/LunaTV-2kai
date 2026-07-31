import type { NotificationChannel } from './notification-channel';
import { inboxNotificationChannel } from './inbox-notification-channel';
import {
  WeChatWorkNotificationChannel,
} from './channels/wechat-work-notification-channel';
import type {
  UserNotificationChannelConfig,
} from './notification-settings-repository';
import { NotificationChannelType } from './notification-settings-repository';
import {
  notificationSettingsService,
} from './notification-settings-service';
import type {
  NotificationDispatchError,
  NotificationDispatchResult,
  NotificationMessage,
} from './notification-types';

interface NotificationDispatchSettingsService {
  shouldDispatch(message: NotificationMessage): Promise<boolean>;
  getEnabledChannelConfigsForUser?(
    userId: string,
  ): Promise<UserNotificationChannelConfig[]>;
}

function toDispatchError(channel: string, error: unknown): NotificationDispatchError {
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

  constructor(
    private readonly settingsService: NotificationDispatchSettingsService = notificationSettingsService,
  ) {}

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

  async dispatch(message: NotificationMessage): Promise<NotificationDispatchResult> {
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
          const factory = this.channelFactories.get(config.type);
          if (factory) return { channel: factory(config), name: config.name };
          const channel = this.channels.get(config.type);
          if (channel) return { channel, name: config.name };
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
notificationDispatcher.register(inboxNotificationChannel);
notificationDispatcher.registerChannelFactory(
  NotificationChannelType.WECHAT_WORK,
  (config) => new WeChatWorkNotificationChannel(config.config),
);
