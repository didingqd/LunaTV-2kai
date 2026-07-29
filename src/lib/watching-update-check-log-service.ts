import type { UpdateResult } from './update-check-types';
import {
  watchingUpdateCheckLogRepository,
  type WatchingUpdateCheckLogRepository,
} from './watching-update-check-log-repository';
import type {
  WatchingUpdateCheckLogEntry,
  WatchingUpdateCheckLogQuery,
  WatchingUpdateCheckLogResult,
  WatchingUpdateCheckLogUpdate,
} from './watching-update-check-log-types';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function toWatchingUpdateCheckLogUpdates(
  results: UpdateResult[],
): WatchingUpdateCheckLogUpdate[] {
  return results.flatMap((result) => {
    if (!result.hasUpdate) return [];
    const releasedEpisodeCount = Math.max(
      0,
      result.metadata.releasedEpisodeCount,
    );
    const oldEpisode =
      result.metadata.baselineEpisode > 0
        ? result.metadata.baselineEpisode
        : Math.max(0, result.latestEpisode - releasedEpisodeCount);
    return [
      {
        resourceId: result.resourceId,
        title: result.title,
        oldEpisode,
        newEpisode: result.latestEpisode,
        source: result.source,
      },
    ];
  });
}

export function createWatchingUpdateCheckLogResult({
  checkedCount,
  successCount,
  failureCount,
  results = [],
}: {
  checkedCount: number;
  successCount: number;
  failureCount: number;
  results?: UpdateResult[];
}): WatchingUpdateCheckLogResult {
  const updates = toWatchingUpdateCheckLogUpdates(results);
  return {
    checkedCount,
    successCount,
    failureCount,
    updateFoundCount: updates.length,
    updates,
  };
}

export class WatchingUpdateCheckLogService {
  constructor(
    private readonly repository: WatchingUpdateCheckLogRepository = watchingUpdateCheckLogRepository,
  ) {}

  async record(entry: Omit<WatchingUpdateCheckLogEntry, 'id'>): Promise<void> {
    await this.repository.append({
      ...entry,
      id: createLogId(),
    });
  }

  list(query?: WatchingUpdateCheckLogQuery) {
    return this.repository.list(query);
  }
}

export const watchingUpdateCheckLogService =
  new WatchingUpdateCheckLogService();
