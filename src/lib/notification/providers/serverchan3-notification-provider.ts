import type {
  NotificationProvider,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationMessage } from '../notification-types';
import {
  createProviderTestMessage,
  getChannelConfig,
  getNotificationContent,
  getRequiredConfigString,
  maskConfigBySchema,
  throwOnUnsuccessfulResponse,
} from './notification-provider-utils';

const schema: NotificationProviderConfigSchema = {
  fields: [
    { key: 'uid', type: 'text', label: '\u8d26\u53f7 UID', required: true },
    { key: 'key', type: 'password', label: 'SendKey', required: true },
  ],
};

export class ServerChan3NotificationProvider implements NotificationProvider {
  readonly type = 'serverchan3';

  async send(
    message: NotificationMessage,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    const config = this.validateConfig(getChannelConfig(channelConfig));
    const { title, content } = getNotificationContent(message);
    const uid = String(config.uid);
    const key = String(config.key);
    const search = new URLSearchParams({ title, desp: content });
    const response = await fetch(
      `https://${uid}.push.ft07.com/send/${encodeURIComponent(key)}.send?${search.toString()}`,
    );
    await throwOnUnsuccessfulResponse(response, 'ServerChan3');
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    await this.send(createProviderTestMessage(), channelConfig);
  }

  validateConfig(config: unknown): Record<string, unknown> {
    const source =
      config && typeof config === 'object' && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : {};
    const uid = getRequiredConfigString(source, 'uid');
    if (!/^[a-zA-Z0-9-]+$/.test(uid)) {
      throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    }
    return { uid, key: getRequiredConfigString(source, 'key') };
  }

  getDisplayName(): string {
    return 'Server?3';
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return schema;
  }

  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    return maskConfigBySchema(config, schema);
  }
}

export const serverChan3NotificationProvider =
  new ServerChan3NotificationProvider();
