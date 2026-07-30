import type {
  WatchingUpdateCheckLogEntry,
  WatchingUpdateCheckLogSource,
} from '@/lib/watching-update-check-log-types';

export interface AdminWatchingUpdateCheckLogsQuery {
  limit?: number;
  source?: WatchingUpdateCheckLogSource;
  userId?: string;
}

export interface AdminWatchingUpdateCheckLogsResponse {
  logs: WatchingUpdateCheckLogEntry[];
  total: number;
}

export class AdminWatchingUpdateCheckLogsApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AdminWatchingUpdateCheckLogsApiError';
  }
}

export async function getAdminWatchingUpdateCheckLogs(
  query: AdminWatchingUpdateCheckLogsQuery = {},
): Promise<AdminWatchingUpdateCheckLogsResponse> {
  const searchParams = new URLSearchParams();
  if (query.limit !== undefined) {
    searchParams.set('limit', String(query.limit));
  }
  if (query.source) {
    searchParams.set('source', query.source);
  }
  if (query.userId) {
    searchParams.set('userId', query.userId);
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const response = await fetch(
    `/api/admin/watching-update-check-logs${suffix}`,
    { cache: 'no-store' },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : `Watching update check logs request failed: ${response.status}`;
    throw new AdminWatchingUpdateCheckLogsApiError(message, response.status);
  }

  return body as AdminWatchingUpdateCheckLogsResponse;
}
