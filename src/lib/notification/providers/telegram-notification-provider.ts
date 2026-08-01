import type {
  NotificationProvider,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationEvent } from '../notification-types';
import {
  createProviderTestEvent,
  escapeHtml,
  fetchWithNotificationTimeout,
  getChannelConfig,
  getNotificationContent,
  getOptionalConfigString,
  getRequiredConfigString,
  maskConfigBySchema,
  trimTrailingSlash,
  validateHttpUrl,
} from './notification-provider-utils';

const schema: NotificationProviderConfigSchema = {
  fields: [
    { key: 'token', type: 'password', label: 'Bot Token', required: true },
    { key: 'chatId', type: 'text', label: 'Chat ID', required: true },
    {
      key: 'apiServer',
      type: 'url',
      label: 'API Server\uff08\u53ef\u9009\uff09',
      placeholder: 'https://api.telegram.org',
    },
  ],
};

async function assertTelegramResponse(response: Response): Promise<void> {
  const data = await response.json().catch(() => null);
  const description =
    data && typeof data === 'object' && 'description' in data
      ? String((data as { description?: unknown }).description)
      : '';
  if (!response.ok) {
    throw new Error(
      description || `Telegram notification failed with ${response.status}`,
    );
  }
  if (
    data &&
    typeof data === 'object' &&
    'ok' in data &&
    (data as { ok?: unknown }).ok === false
  ) {
    throw new Error(description || 'Telegram notification failed');
  }
}

export class TelegramNotificationProvider implements NotificationProvider {
  readonly type = 'telegram';

  async send(
    event: NotificationEvent,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    const config = this.validateConfig(getChannelConfig(channelConfig));
    const token = String(config.token);
    const chatId = String(config.chatId);
    const apiServer = String(config.apiServer || 'https://api.telegram.org');
    const { title, content } = getNotificationContent(event);
    const response = await fetchWithNotificationTimeout(
      `${trimTrailingSlash(apiServer)}/bot${encodeURIComponent(token)}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(content)}`,
          parse_mode: 'HTML',
        }),
      },
    );
    await assertTelegramResponse(response);
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    await this.send(createProviderTestEvent(), channelConfig);
  }

  validateConfig(config: unknown): Record<string, unknown> {
    const source =
      config && typeof config === 'object' && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : {};
    const token = getRequiredConfigString(source, 'token');
    const chatId = getRequiredConfigString(source, 'chatId');
    const apiServer = getOptionalConfigString(source, 'apiServer');
    return {
      token,
      chatId,
      apiServer: apiServer ? validateHttpUrl(apiServer) : '',
    };
  }

  getDisplayName(): string {
    return 'Telegram';
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return schema;
  }

  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    return maskConfigBySchema(config, schema);
  }
}

export const telegramNotificationProvider = new TelegramNotificationProvider();
