// Phase 2 provider migration: wraps the existing WeChat Work sender behind the
// NotificationProvider interface.  Validation, masking, test, and schema metadata
// now live with the provider instead of being scattered through settings services
// or API routes.

import { WeChatWorkNotificationChannel } from '../channels/wechat-work-notification-channel';
import { notificationEventToMessage } from '../notification-event-adapter';
import type {
  NotificationProvider,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationEvent } from '../notification-types';

export class WeChatWorkNotificationProvider implements NotificationProvider {
  readonly type = 'wechat_work';

  async send(
    event: NotificationEvent,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    await new WeChatWorkNotificationChannel(channelConfig.config).send(
      notificationEventToMessage(event),
    );
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    await this.send(
      {
        id: `test-${Date.now()}`,
        type: 'system.error',
        userId: 'notification-test',
        data: {
          title: '\u6d4b\u8bd5\u901a\u77e5',
          content:
            '\u8fd9\u662f\u4e00\u6761\u4f01\u4e1a\u5fae\u4fe1\u901a\u77e5\u6d4b\u8bd5\u6d88\u606f\u3002',
        },
        createdAt: Date.now(),
      },
      channelConfig,
    );
  }

  validateConfig(config: unknown): Record<string, unknown> {
    const source =
      config && typeof config === 'object' && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : {};
    const webhookUrl =
      typeof source.webhookUrl === 'string' ? source.webhookUrl.trim() : '';
    if (!webhookUrl) throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    try {
      const url = new URL(webhookUrl);
      if (url.protocol !== 'https:') {
        throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
      }
    } catch {
      throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    }

    return { webhookUrl };
  }

  getDisplayName(): string {
    return '\u4f01\u4e1a\u5fae\u4fe1';
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return {
      fields: [
        {
          key: 'webhookUrl',
          type: 'url',
          label: 'Webhook \u5730\u5740',
          required: true,
          placeholder:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
        },
      ],
    };
  }

  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    const webhookUrl =
      typeof config.webhookUrl === 'string' ? config.webhookUrl : '';
    if (!webhookUrl) return { webhookUrl: '' };
    const suffix = webhookUrl.slice(-4);
    try {
      const url = new URL(webhookUrl);
      return { webhookUrl: `${url.origin}/****${suffix}` };
    } catch {
      return { webhookUrl: `****${suffix}` };
    }
  }
}

export const wechatWorkNotificationProvider =
  new WeChatWorkNotificationProvider();
