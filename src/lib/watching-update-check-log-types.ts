export const DEFAULT_WATCHING_UPDATE_CHECK_LOG_LIMIT = 200;
export const MIN_WATCHING_UPDATE_CHECK_LOG_LIMIT = 50;
export const MAX_WATCHING_UPDATE_CHECK_LOG_LIMIT = 5000;

export function normalizeWatchingUpdateCheckLogRetentionCount(
  value: unknown,
): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(
        MAX_WATCHING_UPDATE_CHECK_LOG_LIMIT,
        Math.max(MIN_WATCHING_UPDATE_CHECK_LOG_LIMIT, value),
      )
    : DEFAULT_WATCHING_UPDATE_CHECK_LOG_LIMIT;
}

export type WatchingUpdateCheckLogSource = 'cron' | 'app' | 'web' | 'admin';

export type WatchingUpdateCheckLogOperation =
  | 'check'
  | 'scheduled-check'
  | 'sync';

export interface WatchingUpdateCheckLogClient {
  platform?: string;
  version?: string;
  device?: string;
  userAgent?: string;
  ip?: string;
}

export interface WatchingUpdateCheckLogRequest {
  method: string;
  path: string;
  userId?: string;
  body?: unknown;
  client: WatchingUpdateCheckLogClient;
}

export interface WatchingUpdateCheckLogExecution {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface WatchingUpdateCheckLogUpdate {
  resourceId: string;
  title: string;
  oldEpisode: number;
  newEpisode: number;
  source: string;
}

export interface WatchingUpdateCheckLogResult {
  checkedCount: number;
  successCount: number;
  failureCount: number;
  updateFoundCount: number;
  updates: WatchingUpdateCheckLogUpdate[];
}

export interface WatchingUpdateCheckLogEntry {
  id: string;
  source: WatchingUpdateCheckLogSource;
  operation: WatchingUpdateCheckLogOperation;
  request: WatchingUpdateCheckLogRequest;
  execution: WatchingUpdateCheckLogExecution;
  result: WatchingUpdateCheckLogResult;
}

export interface WatchingUpdateCheckLogQuery {
  limit?: number;
  source?: WatchingUpdateCheckLogSource;
  userId?: string;
}
