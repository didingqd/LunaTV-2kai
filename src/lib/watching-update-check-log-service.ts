import type { UpdateResult } from './update-check-types';
import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
} from './system-config-repository';
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
import { normalizeWatchingUpdateCheckLogRetentionCount } from './watching-update-check-log-types';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function storageIsAvailable(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !== 'localstorage'
  );
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
    private readonly config: UpdateCheckConfigReader = systemConfigRepository,
  ) {}

  async record(
    entry: Omit<WatchingUpdateCheckLogEntry, 'id'>,
    options: { userIds?: string[] } = {},
  ): Promise<void> {
    if (!storageIsAvailable()) return;
    const userIds = uniqueUserIds([
      entry.request.userId,
      ...(options.userIds ?? []),
    ]);
    if (userIds.length === 0) {
      await this.repository.appendGlobal(
        {
          ...entry,
          id: createLogId(),
        },
        await this.getRetentionCount(),
      );
      return;
    }

    await Promise.all(
      userIds.map(async (userId) => {
        await this.repository.appendForUser(
          userId,
          {
            ...entry,
            id: createLogId(),
            request: {
              ...entry.request,
              userId,
            },
          },
          await this.getRetentionCount(),
        );
      }),
    );
  }

  async list(query?: WatchingUpdateCheckLogQuery) {
    if (!storageIsAvailable()) return [];
    const retentionCount = await this.getRetentionCount();
    return this.repository.list(retentionCount, query);
  }

  private async getRetentionCount(): Promise<number> {
    try {
      const config = await this.config.getUpdateCheckConfig();
      return normalizeWatchingUpdateCheckLogRetentionCount(
        config.updateCheckLogRetentionCount,
      );
    } catch {
      return normalizeWatchingUpdateCheckLogRetentionCount(undefined);
    }
  }
}

function uniqueUserIds(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => !!value),
    ),
  );
}

export const watchingUpdateCheckLogService =
  new WatchingUpdateCheckLogService();
