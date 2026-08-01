import type {
  NotificationProvider,
  NotificationProviderConfigField,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationEvent } from '../notification-types';
import {
  maskConfigBySchema,
  validateSchemaConfig,
} from './notification-provider-utils';

interface SchemaOnlyProviderDefinition {
  type: string;
  displayName: string;
  fields: NotificationProviderConfigField[];
}

/**
 * Preview providers can be registered, configured and schema-validated. Their
 * send method intentionally remains a no-op until a delivery adapter exists;
 * the presentation metadata exposes this state so validation is never shown as
 * a real external notification.
 */
const schemaOnlyProviderDefinitions: SchemaOnlyProviderDefinition[] = [
  {
    type: 'dingtalk',
    displayName: '\u9489\u9489',
    fields: [
      { key: 'token', type: 'password', label: 'Access Token', required: true },
      { key: 'secret', type: 'password', label: '\u52a0\u7b7e Secret' },
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
      { key: 'secret', type: 'password', label: '\u52a0\u7b7e Secret' },
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
    type: 'notifyx',
    displayName: 'NotifyX',
    fields: [
      { key: 'apiKey', type: 'password', label: 'API Key', required: true },
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
    displayName: 'ntfy',
    fields: [
      { key: 'server', type: 'url', label: '\u670d\u52a1\u5668\u5730\u5740' },
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
  ): Promise<void> {
    // Preview behavior is deliberately harmless for normal dispatches.
  }

  async test(channelConfig: UserNotificationChannelConfig): Promise<void> {
    this.validateConfig(channelConfig.config);
  }

  validateConfig(config: unknown): Record<string, unknown> {
    return validateSchemaConfig(config, this.schema);
  }

  getDisplayName(): string {
    return this.displayName;
  }

  getConfigSchema(): NotificationProviderConfigSchema {
    return this.schema;
  }

  maskConfig(config: Record<string, unknown>): Record<string, unknown> {
    return maskConfigBySchema(config, this.schema);
  }
}

export const schemaOnlyNotificationProviders =
  schemaOnlyProviderDefinitions.map(
    (definition) => new SchemaOnlyNotificationProvider(definition),
  );

export const schemaOnlyNotificationProviderTypes = new Set(
  schemaOnlyProviderDefinitions.map((definition) => definition.type),
);
