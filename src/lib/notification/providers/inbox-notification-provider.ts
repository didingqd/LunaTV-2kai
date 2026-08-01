// Phase 2 provider migration: wraps the existing inbox channel behind the new
// NotificationProvider interface.  The storage/send implementation is preserved;
// only the architecture boundary changes so managers can route events uniformly.

import { inboxNotificationChannel } from '../inbox-notification-channel';
import type { NotificationProviderConfigSchema } from '../notification-provider';
import type { NotificationProvider } from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationMessage } from '../notification-types';
import { createProviderTestMessage } from './notification-provider-utils';

export class InboxNotificationProvider implements NotificationProvider {
  readonly type = 'inbox';

  async send(
    message: NotificationMessage,
    _channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    if (!message.userId) {
      throw new Error('Notification message userId is required');
    }
    await inboxNotificationChannel.send(message);
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    const userId =
      typeof channelConfig.config.userId === 'string'
        ? channelConfig.config.userId
        : '';
    if (!userId) throw new Error('Inbox notification test requires userId');
    await this.send(createProviderTestMessage(userId), channelConfig);
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
