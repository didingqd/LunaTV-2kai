import type { UpdateObservation, UpdateResult } from '@/lib/update-check-types';

export interface WatchingUpdatesCapabilityResponse {
  supported: boolean;
  enabled: boolean;
  userAllowed: boolean;
  backendEnabled?: boolean;
  userEnabled?: boolean;
  mode: 'local' | 'backend';
  reason?: string;
}

export interface WatchingUpdatesResultsResponse {
  userId: string;
  enabled: boolean;
  mode: 'local' | 'backend';
  capability: {
    enabled: boolean;
    backendEnabled: boolean;
    userEnabled: boolean;
    mode: 'local' | 'backend';
    reason?: string;
  };
  generatedAt: number;
  results: UpdateResult[] | null;
}

export type WatchingUpdateObservationInput = Omit<UpdateObservation, 'userId'>;

export interface WatchingUpdatesCheckResponse {
  checkedAt: number;
  results: UpdateResult[];
  errors: Array<{ followId: string; error: string }>;
}

export interface WatchingUpdatesSyncResponse {
  syncedAt: number;
  accepted: false | UpdateResult[];
  rejected: Array<{ followId: string; reason: string }>;
  reason?: string;
}

export interface WatchingUpdatesRepositoryContract {
  getCapability(): Promise<WatchingUpdatesCapabilityResponse>;
  getResults(): Promise<WatchingUpdatesResultsResponse>;
  check(followIds?: string[]): Promise<WatchingUpdatesCheckResponse>;
  sync(
    observations: WatchingUpdateObservationInput[],
  ): Promise<WatchingUpdatesSyncResponse>;
}

export class WatchingUpdatesRepository implements WatchingUpdatesRepositoryContract {
  getCapability(): Promise<WatchingUpdatesCapabilityResponse> {
    return requestJson('/api/watching-updates/capability');
  }

  getResults(): Promise<WatchingUpdatesResultsResponse> {
    return requestJson('/api/watching-updates/results');
  }

  check(followIds?: string[]): Promise<WatchingUpdatesCheckResponse> {
    return requestJson('/api/watching-updates/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(followIds ? { followIds } : {}),
    });
  }

  sync(
    observations: WatchingUpdateObservationInput[],
  ): Promise<WatchingUpdatesSyncResponse> {
    return requestJson('/api/watching-updates/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observations }),
    });
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      ...init,
      signal: init?.signal ?? controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String(body.error)
          : `Watching Updates request failed: ${response.status}`;
      throw new Error(message);
    }
    return body as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const watchingUpdatesRepository = new WatchingUpdatesRepository();
