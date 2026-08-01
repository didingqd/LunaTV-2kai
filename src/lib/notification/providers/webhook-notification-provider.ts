import type {
  NotificationProvider,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationMessage } from '../notification-types';
import {
  createProviderTestMessage,
  fetchWithNotificationTimeout,
  getChannelConfig,
  getConfigRecord,
  getNotificationContent,
  getOptionalConfigString,
  getRequiredConfigString,
  maskConfigBySchema,
  throwOnUnsuccessfulResponse,
  validateHttpUrl,
} from './notification-provider-utils';

const schema: NotificationProviderConfigSchema = {
  fields: [
    {
      key: 'url',
      type: 'url',
      label: 'URL',
      required: true,
      placeholder: 'https://example.com/webhook',
    },
    {
      key: 'headers',
      type: 'text',
      label: 'Headers\uff08\u53ef\u9009\uff09',
      placeholder: 'JSON \u5bf9\u8c61',
    },
    {
      key: 'body',
      type: 'text',
      label: 'Body \u6a21\u677f\uff08\u53ef\u9009\uff09',
      placeholder: '{title} {body}',
    },
  ],
};

function parseHeaders(value: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, header]) => {
        if (typeof header !== 'string') {
          throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
        }
        return [key, header];
      }),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'INVALID_NOTIFICATION_CHANNEL_CONFIG'
    ) {
      throw error;
    }
    throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
  }
}

function renderBody(template: string, title: string, content: string): string {
  if (!template) return JSON.stringify({ title, content });
  const safeTitle = JSON.stringify(title).slice(1, -1);
  const safeContent = JSON.stringify(content).slice(1, -1);
  return template
    .replaceAll('{title}', safeTitle)
    .replaceAll('{body}', safeContent)
    .replaceAll('{content}', safeContent);
}

function buildWebhookPayload(
  message: NotificationMessage,
  template: string,
  title: string,
  content: string,
) {
  return {
    title,
    content,
    message: content,
    eventType: message.type,
    eventId:
      typeof message.payload?.payloadId === 'string'
        ? message.payload.payloadId
        : undefined,
    createdAt: message.createdAt,
    data: message.payload ?? {},
    ...(typeof message.payload?.displayTime === 'string'
      ? { displayTime: message.payload.displayTime }
      : {}),
    ...(template ? { body: renderBody(template, title, content) } : {}),
  };
}

export class WebhookNotificationProvider implements NotificationProvider {
  readonly type = 'webhook';

  async send(
    message: NotificationMessage,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    const config = this.validateConfig(getChannelConfig(channelConfig));
    const { title, content } = getNotificationContent(message);
    const headers = {
      'Content-Type': 'application/json',
      ...parseHeaders(String(config.headers)),
    };
    const response = await fetchWithNotificationTimeout(String(config.url), {
      method: 'POST',
      headers,
      body: JSON.stringify(
        buildWebhookPayload(message, String(config.body), title, content),
      ),
    });
    await throwOnUnsuccessfulResponse(response, 'Webhook');
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    await this.send(createProviderTestMessage(), channelConfig);
  }

  validateConfig(config: unknown): Record<string, unknown> {
    const source = getConfigRecord(config);
    const url = validateHttpUrl(getRequiredConfigString(source, 'url'));
    const headers = getOptionalConfigString(source, 'headers');
    parseHeaders(headers);
    return {
      url,
      headers,
      body: getOptionalConfigString(source, 'body'),
    };
  }

  getDisplayName(): string {
    return 'Webhook';
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return schema;
  }

  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    return maskConfigBySchema(config, schema);
  }
}

export const webhookNotificationProvider = new WebhookNotificationProvider();
