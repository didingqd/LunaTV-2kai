import type { NotificationChannel } from './notification-channel';
import type {
  NotificationDispatchError,
  NotificationDispatchResult,
  NotificationMessage,
} from './notification-types';

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

  register(channel: NotificationChannel): void {
    this.channels.set(channel.name, channel);
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
