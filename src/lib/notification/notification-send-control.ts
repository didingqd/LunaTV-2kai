import type { NotificationProvider } from './notification-provider';
import type { UserNotificationChannelConfig } from './notification-settings-repository';
import type {
  NotificationEvent,
  NotificationMessage,
  NotificationPayload,
} from './notification-types';

export const DEFAULT_NOTIFICATION_PROVIDER_TIMEOUT_MS = 10_000;
export const DEFAULT_NOTIFICATION_RETRY_DELAY_MS = 100;
export const DEFAULT_NOTIFICATION_MAX_ATTEMPTS = 2;
export const DEFAULT_NOTIFICATION_DEDUP_WINDOW_MS = 10_000;

interface RetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

const recentEventDispatches = new Map<string, number>();

function getNotificationUserId(
  event: NotificationEvent | NotificationPayload,
): string | undefined {
  return (
    (event as NotificationPayload).targetUser ??
    (event as NotificationEvent).userId
  );
}

export function isNotificationDebugEvent(
  event: NotificationEvent | NotificationPayload,
): boolean {
  const data = event.data;
  const metadataSource =
    'metadata' in event && event.metadata ? event.metadata : data.metadata;
  const metadata =
    metadataSource &&
    typeof metadataSource === 'object' &&
    !Array.isArray(metadataSource)
      ? (metadataSource as Record<string, unknown>)
      : {};
  return metadata.debug === true || data.source === 'notification-debug';
}

export function shouldSkipDuplicateNotificationEvent(
  event: NotificationEvent | NotificationPayload,
  now: number,
  windowMs = DEFAULT_NOTIFICATION_DEDUP_WINDOW_MS,
): boolean {
  if (isNotificationDebugEvent(event)) return false;

  const userId = getNotificationUserId(event);
  const key = `${userId ?? 'global'}:${event.type}`;
  const previous = recentEventDispatches.get(key);
  if (typeof previous === 'number' && now - previous < windowMs) {
    return true;
  }

  recentEventDispatches.set(key, now);
  return false;
}

export function clearNotificationDedupeStateForTests(): void {
  recentEventDispatches.clear();
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs = DEFAULT_NOTIFICATION_PROVIDER_TIMEOUT_MS,
): Promise<T> {
  if (timeoutMs <= 0) return operation;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Notification provider timed out')),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export async function sendProviderWithRetry(
  provider: NotificationProvider,
  message: NotificationMessage,
  channel: UserNotificationChannelConfig,
  options: RetryOptions = {},
): Promise<void> {
  const maxAttempts = Math.max(
    1,
    Math.floor(options.maxAttempts ?? DEFAULT_NOTIFICATION_MAX_ATTEMPTS),
  );
  const retryDelayMs = Math.max(
    0,
    options.retryDelayMs ?? DEFAULT_NOTIFICATION_RETRY_DELAY_MS,
  );
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_NOTIFICATION_PROVIDER_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await withTimeout(provider.send(message, channel), timeoutMs);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await delay(retryDelayMs);
    }
  }

  throw lastError;
}

export function sanitizeNotificationErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error && error.message
      ? error.message
      : error &&
          typeof error === 'object' &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Unknown notification dispatch error';
  return raw
    .replace(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /\b(token|secret|api[-_]?key|key|webhook)(=|:)\s*[^,\s&]+/gi,
      '$1$2[redacted]',
    )
    .slice(0, 500);
}
