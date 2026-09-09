import type {
  NotificationProviderConfigField,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import {
  applyChannelContentTemplate,
  notificationTemplateVariableRegistry,
} from '../notification-template';
import type { NotificationMessage } from '../notification-types';

const DEFAULT_NOTIFICATION_REQUEST_TIMEOUT_MS = 10_000;

export function getConfigRecord(config: unknown): Record<string, unknown> {
  return config && typeof config === 'object' && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

export function getRequiredConfigString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = getOptionalConfigString(config, key);
  if (!value) throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
  return value;
}

export function getOptionalConfigString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function validateHttpUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    }
  } catch {
    throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
  }
  return value;
}

export function validateSchemaConfig(
  config: unknown,
  schema: NotificationProviderConfigSchema,
): Record<string, unknown> {
  const source = getConfigRecord(config);
  return schema.fields.reduce<Record<string, unknown>>((next, field) => {
    const value = getOptionalConfigString(source, field.key);
    if (field.required && !value) {
      throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
    }
    next[field.key] =
      field.type === 'url' && value ? validateHttpUrl(value) : value;
    return next;
  }, {});
}

export function maskConfigBySchema(
  config: Record<string, unknown>,
  schema: NotificationProviderConfigSchema,
): Record<string, unknown> {
  return schema.fields.reduce<Record<string, unknown>>((masked, field) => {
    const value = getOptionalConfigString(config, field.key);
    masked[field.key] = shouldMask(field) ? maskValue(value) : value;
    return masked;
  }, {});
}

function shouldMask(field: NotificationProviderConfigField): boolean {
  return (
    field.type === 'password' ||
    /token|secret|key|url|header|body/i.test(field.key)
  );
}

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

export function getNotificationContent(message: NotificationMessage) {
  return { title: message.title, content: message.content };
}

export function createProviderTestMessage(
  userId = 'notification-test',
  // \u4fee\u6539\u70b9\uff1a\u53ef\u9009\u7684\u6e20\u9053\u914d\u7f6e \u2014\u2014 \u4f20\u5165\u65f6\u4f18\u5148\u4f7f\u7528\u6e20\u9053\u8ba2\u9605\u4e8b\u4ef6\u6ce8\u518c\u7684\u6d4b\u8bd5\u6837\u4f8b\u6d88\u606f\uff0c
  // \u5e76\u6309\u6e20\u9053\u5185\u5bb9\u6a21\u677f\u6e32\u67d3\uff0c\u4f7f\u4efb\u610f\u6e20\u9053\u7684"\u53d1\u9001\u6d4b\u8bd5"\u90fd\u80fd\u9884\u89c8\u6a21\u677f\u6548\u679c
  channelConfig?: { subscribedEvents?: string[] } & {
    config: Record<string, unknown>;
  },
): NotificationMessage {
  if (channelConfig) {
    const subscribedEvents = Array.isArray(channelConfig.subscribedEvents)
      ? channelConfig.subscribedEvents
      : [];
    // \u4fee\u6539\u70b9\uff1a\u6309\u6e20\u9053\u8ba2\u9605\u987a\u5e8f\u627e\u5230\u7b2c\u4e00\u4e2a\u63d0\u4f9b\u6d4b\u8bd5\u6837\u4f8b\u7684\u4e8b\u4ef6\uff08\u4e0d\u611f\u77e5\u5177\u4f53\u4e1a\u52a1\u57df\uff09
    const testMessageResolver = notificationTemplateVariableRegistry
      .list()
      .find(
        ({ eventType, resolver }) =>
          subscribedEvents.includes(eventType) && resolver.createTestMessage,
      )?.resolver;
    if (testMessageResolver?.createTestMessage) {
      return applyChannelContentTemplate(
        testMessageResolver.createTestMessage(userId),
        channelConfig,
      );
    }
  }

  const createdAt = Date.now();
  const content =
    '\u8fd9\u662f\u4e00\u6761 LunaTV \u6d4b\u8bd5\u901a\u77e5\u3002';
  return {
    userId,
    type: 'system.error',
    title: '\u6d4b\u8bd5\u901a\u77e5',
    body: content,
    content,
    createdAt,
    payload: {
      payloadId: `test-${createdAt}`,
      eventType: 'system.error',
      eventCreatedAt: createdAt,
    },
  };
}

export async function throwOnUnsuccessfulResponse(
  response: Response,
  providerName: string,
): Promise<void> {
  if (response.ok) return;
  throw new Error(
    `${providerName} notification failed with ${response.status}`,
  );
}

export async function fetchWithNotificationTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_NOTIFICATION_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Notification request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function getChannelConfig(
  channelConfig: UserNotificationChannelConfig,
): Record<string, unknown> {
  return channelConfig.config;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"') return '&quot;';
    return '&#39;';
  });
}
