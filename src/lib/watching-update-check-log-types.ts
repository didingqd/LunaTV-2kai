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

export type WatchingUpdateCheckLogSource =
  | 'cron'
  | 'app'
  | 'web'
  | 'admin'
  | 'trigger';

export type WatchingUpdateCheckLogOperation =
  | 'check'
  | 'scheduled-check'
  | 'sync'
  | 'manual-trigger';

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
  /**
   * Stage 4H-H: requestedBy / trigger keep JobRunner audit metadata queryable
   * without overloading userId; cron runners such as Vercel or Docker are not
   * real users, while trigger/app callers can still be associated with userId.
   */
  requestedBy?: string;
  trigger?: string;
  body?: unknown;
  client: WatchingUpdateCheckLogClient;
}

export type WatchingUpdateCheckLogExecutionStage = 'started' | 'finished';

export interface WatchingUpdateCheckLogExecution {
  /**
   * Stage 4H-H: stage distinguishes JobRunner start and finish audit records
   * while preserving the existing operation/source model and historical logs.
   */
  stage?: WatchingUpdateCheckLogExecutionStage;
  startedAt: number;
  endedAt: number;
  finishedAt?: number;
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
