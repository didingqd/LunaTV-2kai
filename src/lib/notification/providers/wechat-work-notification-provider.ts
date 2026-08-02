// Phase 2 provider migration: wraps the existing WeChat Work sender behind the
// NotificationProvider interface.  Validation, masking, test, and schema metadata
// now live with the provider instead of being scattered through settings services
// or API routes.

import { WeChatWorkNotificationChannel } from '../channels/wechat-work-notification-channel';
import type {
  NotificationProvider,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationMessage } from '../notification-types';
import {
  createWatchingUpdateFoundPayload,
  watchingUpdateNotificationBuilder,
} from '../../watching-update-notification-builder';

const WECHAT_WORK_TEST_CHECKED_AT = Date.parse('2026-08-02T04:30:01.000Z');
const WECHAT_WORK_TEST_TIMEZONE = 'Asia/Shanghai';
const WECHAT_WORK_TEST_DISPLAY_TIME = '2026-08-02 12:30:01';

function createWeChatWorkTestMessage(
  userId = 'notification-test',
): NotificationMessage {
  const message = watchingUpdateNotificationBuilder.build(
    createWatchingUpdateFoundPayload({
      userId,
      newUpdates: [
        {
          followId: 'wechat-work-test-a',
          title: '测试番剧 A',
          fromEpisode: 12,
          toEpisode: 13,
        },
      ],
      updated: [
        {
          followId: 'wechat-work-test-b',
          title: '测试番剧 B',
          fromEpisode: 5,
          toEpisode: 6,
        },
        {
          followId: 'wechat-work-test-c',
          title: '测试番剧 C',
          fromEpisode: 18,
          toEpisode: 20,
        },
      ],
      checkedAt: WECHAT_WORK_TEST_CHECKED_AT,
      timezone: WECHAT_WORK_TEST_TIMEZONE,
      displayTime: WECHAT_WORK_TEST_DISPLAY_TIME,
    }),
  );

  if (!message) throw new Error('INVALID_WECHAT_WORK_TEST_NOTIFICATION');
  return message;
}

export class WeChatWorkNotificationProvider implements NotificationProvider {
  readonly type = 'wechat_work';

  async send(
    message: NotificationMessage,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    await new WeChatWorkNotificationChannel(channelConfig.config).send(message);
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    await this.send(
      createWeChatWorkTestMessage(
        typeof channelConfig.config.userId === 'string'
          ? channelConfig.config.userId
          : undefined,
      ),
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
