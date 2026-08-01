import { notificationEventToMessage } from '../notification-event-adapter';
import type {
  NotificationProviderConfigField,
  NotificationProviderConfigSchema,
} from '../notification-provider';
import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import type { NotificationEvent } from '../notification-types';

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

export function getNotificationContent(event: NotificationEvent) {
  const message = notificationEventToMessage(event);
  return { title: message.title, content: message.content };
}

export function createProviderTestEvent(): NotificationEvent {
  return {
    id: `test-${Date.now()}`,
    type: 'system.error',
    userId: 'notification-test',
    data: {
      title: '\u6d4b\u8bd5\u901a\u77e5',
      content: '\u8fd9\u662f\u4e00\u6761 LunaTV \u6d4b\u8bd5\u901a\u77e5\u3002',
    },
    createdAt: Date.now(),
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
