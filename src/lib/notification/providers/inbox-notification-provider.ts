// Phase 2 provider migration: wraps the existing inbox channel behind the new
// NotificationProvider interface.  The storage/send implementation is preserved;
// only the architecture boundary changes so managers can route events uniformly.

import { inboxNotificationChannel } from '../inbox-notification-channel';
import { notificationEventToMessage } from '../notification-event-adapter';
import type { NotificationProviderConfigSchema } from '../notification-provider';
import type { NotificationProvider } from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationEvent } from '../notification-types';

export class InboxNotificationProvider implements NotificationProvider {
  readonly type = 'inbox';

  async send(
    event: NotificationEvent,
    _channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    if (!event.userId) throw new Error('Notification event userId is required');
    await inboxNotificationChannel.send(notificationEventToMessage(event));
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    const userId =
      typeof channelConfig.config.userId === 'string'
        ? channelConfig.config.userId
        : '';
    if (!userId) throw new Error('Inbox notification test requires userId');
    await this.send(
      {
        id: `test-${Date.now()}`,
        type: 'system.error',
        userId,
        data: {
          title: '\u6d4b\u8bd5\u901a\u77e5',
          content:
            '\u8fd9\u662f\u4e00\u6761\u7ad9\u5185\u901a\u77e5\u6d4b\u8bd5\u6d88\u606f\u3002',
        },
        createdAt: Date.now(),
      },
      channelConfig,
    );
  }

  validateConfig(_config: unknown): Record<string, unknown> {
    return {};
  }

  getDisplayName(): string {
    return '\u7ad9\u5185\u901a\u77e5';
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return { fields: [] };
  }
}

export const inboxNotificationProvider = new InboxNotificationProvider();
