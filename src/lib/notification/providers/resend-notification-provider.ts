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
  getRequiredConfigString,
  maskConfigBySchema,
} from './notification-provider-utils';

const schema: NotificationProviderConfigSchema = {
  fields: [
    { key: 'apiKey', type: 'password', label: 'API Key', required: true },
    { key: 'from', type: 'text', label: '\u53d1\u4ef6\u4eba', required: true },
    { key: 'to', type: 'text', label: '\u6536\u4ef6\u4eba', required: true },
    { key: 'subject', type: 'text', label: 'Subject' },
  ],
};

async function assertResendResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const data = await response.json().catch(() => null);
  const message =
    data && typeof data === 'object' && 'message' in data
      ? String((data as { message?: unknown }).message)
      : '';
  throw new Error(
    message || `Resend notification failed with ${response.status}`,
  );
}

export class ResendNotificationProvider implements NotificationProvider {
  readonly type = 'resend';

  async send(
    message: NotificationMessage,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {
    const config = this.validateConfig(getChannelConfig(channelConfig));
    const { title, content } = getNotificationContent(message);
    const response = await fetchWithNotificationTimeout(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${String(config.apiKey)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: String(config.from),
          to: String(config.to)
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          subject: String(config.subject || title),
          text: content,
        }),
      },
    );
    await assertResendResponse(response);
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    await this.send(createProviderTestMessage(), channelConfig);
  }

  validateConfig(config: unknown): Record<string, unknown> {
    const source = getConfigRecord(config);
    return {
      apiKey: getRequiredConfigString(source, 'apiKey'),
      from: getRequiredConfigString(source, 'from'),
      to: getRequiredConfigString(source, 'to'),
      subject: typeof source.subject === 'string' ? source.subject.trim() : '',
    };
  }

  getDisplayName(): string {
    return 'Email';
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return schema;
  }

  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    return maskConfigBySchema(config, schema);
  }
}

export const resendNotificationProvider = new ResendNotificationProvider();
