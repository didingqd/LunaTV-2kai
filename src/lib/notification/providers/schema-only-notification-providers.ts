import type {
  NotificationProvider,
  NotificationProviderConfigField,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationEvent } from '../notification-types';

interface SchemaOnlyProviderDefinition {
  type: string;
  displayName: string;
  fields: NotificationProviderConfigField[];
}
const schemaOnlyProviderDefinitions: SchemaOnlyProviderDefinition[] = [
  {
    type: 'telegram',
    displayName: 'Telegram',
    fields: [
      { key: 'token', type: 'password', label: 'Bot Token', required: true },
      { key: 'chatId', type: 'text', label: 'Chat ID', required: true },
      {
        key: 'apiServer',
        type: 'url',
        label: 'API Server\uff08\u53ef\u9009\uff09',
      },
    ],
  },
  {
    type: 'bark',
    displayName: 'Bark',
    fields: [
      {
        key: 'server',
        type: 'url',
        label: '\u670d\u52a1\u5668\u5730\u5740\uff08\u53ef\u9009\uff09',
      },
      {
        key: 'key',
        type: 'password',
        label: '\u8bbe\u5907 Key',
        required: true,
      },
    ],
  },
  {
    type: 'pushplus',
    displayName: 'PushPlus',
    fields: [
      { key: 'token', type: 'password', label: 'Token', required: true },
    ],
  },
  {
    type: 'dingtalk',
    displayName: '\u9489\u9489',
    fields: [
      { key: 'token', type: 'password', label: 'Access Token', required: true },
      {
        key: 'secret',
        type: 'password',
        label: 'Secret\uff08\u53ef\u9009\uff09',
      },
    ],
  },
  {
    type: 'lark',
    displayName: '\u98de\u4e66',
    fields: [
      {
        key: 'token',
        type: 'password',
        label: 'Webhook Token',
        required: true,
      },
      {
        key: 'secret',
        type: 'password',
        label: '\u7b7e\u540d\u5bc6\u94a5\uff08\u53ef\u9009\uff09',
      },
    ],
  },
  {
    type: 'wecom',
    displayName: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba',
    fields: [
      {
        key: 'token',
        type: 'password',
        label: '\u673a\u5668\u4eba Key',
        required: true,
      },
    ],
  },
  {
    type: 'serverchan3',
    displayName: 'Server\u91713',
    fields: [
      { key: 'uid', type: 'text', label: '\u7528\u6237 UID', required: true },
      { key: 'key', type: 'password', label: 'SendKey', required: true },
    ],
  },
  {
    type: 'notifyx',
    displayName: 'NotifyX',
    fields: [
      { key: 'apiKey', type: 'password', label: 'API Key', required: true },
    ],
  },
  {
    type: 'resend',
    displayName: 'Email',
    fields: [
      { key: 'apiKey', type: 'password', label: 'API Key', required: true },
      {
        key: 'from',
        type: 'text',
        label: '\u53d1\u4ef6\u4eba',
        required: true,
      },
      { key: 'to', type: 'text', label: '\u6536\u4ef6\u4eba', required: true },
    ],
  },
  {
    type: 'webhook',
    displayName: 'Webhook',
    fields: [
      { key: 'url', type: 'url', label: 'URL', required: true },
      {
        key: 'headers',
        type: 'text',
        label: 'Headers\uff08\u53ef\u9009\uff09',
      },
      {
        key: 'body',
        type: 'text',
        label: 'Body \u6a21\u677f\uff08\u53ef\u9009\uff09',
      },
    ],
  },
  {
    type: 'gotify',
    displayName: 'Gotify',
    fields: [
      {
        key: 'server',
        type: 'url',
        label: '\u670d\u52a1\u5668\u5730\u5740',
        required: true,
      },
      {
        key: 'token',
        type: 'password',
        label: '\u5e94\u7528 Token',
        required: true,
      },
    ],
  },
  {
    type: 'ntfy',
    displayName: 'Ntfy',
    fields: [
      {
        key: 'server',
        type: 'url',
        label: '\u670d\u52a1\u5668\u5730\u5740\uff08\u53ef\u9009\uff09',
      },
      { key: 'topic', type: 'text', label: 'Topic', required: true },
      {
        key: 'token',
        type: 'password',
        label: 'Token\uff08\u53ef\u9009\uff09',
      },
    ],
  },
];

class SchemaOnlyNotificationProvider implements NotificationProvider {
  readonly type: string;
  private readonly displayName: string;
  private readonly schema: NotificationProviderConfigSchema;
  constructor(definition: SchemaOnlyProviderDefinition) {
    this.type = definition.type;
    this.displayName = definition.displayName;
    this.schema = { fields: definition.fields };
  }
  async send(
    _event: NotificationEvent,
    _channelConfig: UserNotificationChannelConfig,
  ): Promise<void> {}
  async test(_channelConfig: UserNotificationChannelConfig): Promise<void> {
    await Promise.resolve();
  }
  validateConfig(config: unknown): Record<string, unknown> {
    const source =
      config && typeof config === 'object' && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : {};
    return this.schema.fields.reduce<Record<string, unknown>>((next, field) => {
      const rawValue = source[field.key];
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (field.required && !value)
        throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
      if (field.type === 'url' && value) {
        try {
          const parsed = new URL(value);
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
        } catch {
          throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
        }
      }
      next[field.key] = value;
      return next;
    }, {});
  }
  getDisplayName(): string {
    return this.displayName;
  }
  getConfigSchema(): NotificationProviderConfigSchema {
    return this.schema;
  }
  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    return this.schema.fields.reduce<Record<string, unknown>>(
      (masked, field) => {
        const value =
          typeof config[field.key] === 'string'
            ? String(config[field.key])
            : '';
        masked[field.key] = shouldMask(field.key, field.type)
          ? maskValue(value)
          : value;
        return masked;
      },
      {},
    );
  }
}
function shouldMask(
  key: string,
  type: NotificationProviderConfigField['type'],
): boolean {
  return type === 'password' || /token|secret|key|url|header|body/i.test(key);
}
function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}
export const schemaOnlyNotificationProviders =
  schemaOnlyProviderDefinitions.map(
    (definition) => new SchemaOnlyNotificationProvider(definition),
  );
