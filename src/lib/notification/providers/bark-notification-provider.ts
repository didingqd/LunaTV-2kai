import type {
  NotificationProvider,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationEvent } from '../notification-types';
import {
  createProviderTestEvent,
  getChannelConfig,
  getNotificationContent,
  getOptionalConfigString,
  getRequiredConfigString,
  maskConfigBySchema,
  throwOnUnsuccessfulResponse,
  trimTrailingSlash,
  validateHttpUrl,
} from './notification-provider-utils';

const schema: NotificationProviderConfigSchema = {
  fields: [
    {
      key: 'server',
      type: 'url',
      label: '\u670d\u52a1\u5668\u5730\u5740',
      placeholder: 'https://api.day.app',
    },
    { key: 'key', type: 'password', label: '\u8bbe\u5907 Key', required: true },
  ],
};

export class BarkNotificationProvider implements NotificationProvider {
  readonly type = 'bark';

  async send(
    event: NotificationEvent,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    const config = this.validateConfig(getChannelConfig(channelConfig));
    const key = String(config.key);
    const server = String(config.server || 'https://api.day.app');
    const { title, content } = getNotificationContent(event);
    const response = await fetch(
      `${trimTrailingSlash(server)}/${encodeURIComponent(key)}/${encodeURIComponent(title)}/${encodeURIComponent(content)}?group=LunaTV`,
    );
    await throwOnUnsuccessfulResponse(response, 'Bark');
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    await this.send(createProviderTestEvent(), channelConfig);
  }

  validateConfig(config: unknown): Record<string, unknown> {
    const source =
      config && typeof config === 'object' && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : {};
    const server = getOptionalConfigString(source, 'server');
    return {
      server: server ? validateHttpUrl(server) : '',
      key: getRequiredConfigString(source, 'key'),
    };
  }

  getDisplayName(): string {
    return 'Bark';
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return schema;
  }

  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    return maskConfigBySchema(config, schema);
  }
}

export const barkNotificationProvider = new BarkNotificationProvider();


