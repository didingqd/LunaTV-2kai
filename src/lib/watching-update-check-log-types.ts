export const WATCHING_UPDATE_CHECK_LOG_LIMIT = 200;

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
