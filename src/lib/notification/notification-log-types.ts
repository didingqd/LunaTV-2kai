export const DEFAULT_NOTIFICATION_LOG_LIMIT = 200;
export const MIN_NOTIFICATION_LOG_LIMIT = 1;
export const MAX_NOTIFICATION_LOG_LIMIT = 500;

export type NotificationSendStatus = 'success' | 'failed' | 'skipped';
export type NotificationProviderHealthStatus = 'healthy' | 'warning' | 'failed';

export interface NotificationSendLogEntry {
  eventType: string;
  channelId: string;
  providerType: string;
  status: NotificationSendStatus;
  error?: string;
  createdAt: number;
}

export interface NotificationSendLogQuery {
  limit?: number;
  providerType?: string;
  channelId?: string;
  status?: NotificationSendStatus;
}

export function normalizeNotificationLogLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return DEFAULT_NOTIFICATION_LOG_LIMIT;
  }
  return Math.min(
    MAX_NOTIFICATION_LOG_LIMIT,
    Math.max(MIN_NOTIFICATION_LOG_LIMIT, value),
  );
}
