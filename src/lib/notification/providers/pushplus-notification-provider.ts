import type {
  NotificationProvider,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationMessage } from '../notification-types';
import {
  createProviderTestMessage,
  escapeHtml,
  getChannelConfig,
  getNotificationContent,
  getRequiredConfigString,
  maskConfigBySchema,
  throwOnUnsuccessfulResponse,
} from './notification-provider-utils';

const schema: NotificationProviderConfigSchema = {
  fields: [{ key: 'token', type: 'password', label: 'Token', required: true }],
};

export class PushPlusNotificationProvider implements NotificationProvider {
  readonly type = 'pushplus';

  async send(
    message: NotificationMessage,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    const config = this.validateConfig(getChannelConfig(channelConfig));
    const { title, content } = getNotificationContent(message);
    const response = await fetch('https://www.pushplus.plus/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: String(config.token),
        title,
        content: escapeHtml(content).replace(/\n/g, '<br>'),
        template: 'html',
      }),
    });
    await throwOnUnsuccessfulResponse(response, 'PushPlus');
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    await this.send(createProviderTestMessage(), channelConfig);
  }

  validateConfig(config: unknown): Record<string, unknown> {
    const source =
      config && typeof config === 'object' && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : {};
    return { token: getRequiredConfigString(source, 'token') };
  }

  getDisplayName(): string {
    return 'PushPlus';
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return schema;
  }

  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    return maskConfigBySchema(config, schema);
  }
}

export const pushPlusNotificationProvider = new PushPlusNotificationProvider();
