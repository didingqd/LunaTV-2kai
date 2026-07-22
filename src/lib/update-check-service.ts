import type { PlayRecord, WatchingFollow } from './types';
import {
  calculateWatchingUpdate,
  DEFAULT_WATCH_COMPLETION_THRESHOLD,
  watchedEpisodesForRecord,
} from './watching-update-calculation';
import { watchingFollowStorageKey } from './watching-follow';
import {
  CachedUpdateCheckTaskRepository,
  CachedUpdateObservationRepository,
  CachedUpdateResultRepository,
  updateCheckTaskId,
  type UpdateCheckTaskRepository,
  type UpdateObservationRepository,
  type UpdateResultRepository,
} from './update-check-repository';
import {
  DEFAULT_UPDATE_CHECK_EXPIRE_MS,
  UPDATE_CHECK_ALGORITHM_VERSION,
  type UpdateCheckTask,
  type UpdateObservation,
  type UpdateResult,
} from './update-check-types';
import type { LatestEpisodeProviderRegistry } from './latest-episode-provider';
import { db } from './db';
import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
} from './system-config-repository';
import {
  updateCheckCapabilityService,
  type UpdateCheckCapabilityReader,
} from './update-check-capability';

export interface UpdateFactsRepository {
  getWatchingFollow(
    userId: string,
    source: string,
    id: string,
  ): Promise<WatchingFollow | null>;
  getAllWatchingFollows(
    userId: string,
  ): Promise<Record<string, WatchingFollow>>;
  getPlayRecord(
    userId: string,
    source: string,
    id: string,
  ): Promise<PlayRecord | null>;
}

export interface UpdateCheckServiceDependencies {
  facts?: UpdateFactsRepository;
  results?: UpdateResultRepository;
  observations?: UpdateObservationRepository;
  tasks?: UpdateCheckTaskRepository;
  providers?: LatestEpisodeProviderRegistry;
  config?: UpdateCheckConfigReader;
  capability?: UpdateCheckCapabilityReader;
  now?: () => number;
}

export interface UpdateCheckBatch {
  results: UpdateResult[];
  errors: Array<{ followId: string; error: string }>;
}

function normalizeEpisode(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class UpdateCheckService {
  private readonly facts: UpdateFactsRepository;
  private readonly results: UpdateResultRepository;
  private readonly observations: UpdateObservationRepository;
  private readonly tasks: UpdateCheckTaskRepository;
  private providers?: LatestEpisodeProviderRegistry;
  private readonly config: UpdateCheckConfigReader;
  private readonly capability: UpdateCheckCapabilityReader;
  private readonly clock: () => number;

  constructor(dependencies: UpdateCheckServiceDependencies = {}) {
    this.facts = dependencies.facts ?? db;
    this.results = dependencies.results ?? new CachedUpdateResultRepository();
    this.observations =
      dependencies.observations ?? new CachedUpdateObservationRepository();
    this.tasks = dependencies.tasks ?? new CachedUpdateCheckTaskRepository();
    this.providers = dependencies.providers;
    this.config = dependencies.config ?? systemConfigRepository;
    this.capability = dependencies.capability ?? updateCheckCapabilityService;
    this.clock = dependencies.now ?? Date.now;
  }

  async getResultsForUser(userId: string): Promise<UpdateResult[]> {
    if (!(await this.isBackendEnabled(userId))) return [];
    const follows = await this.facts.getAllWatchingFollows(userId);
    const activeFollows = Object.values(follows).filter(
      (follow) => follow.enabled,
    );
    await Promise.all(
      activeFollows.map((follow) => this.ensureTask(userId, follow)),
    );
    const activeIds = new Set(
      activeFollows.map((follow) =>
        watchingFollowStorageKey(follow.source, follow.id),
      ),
    );
    const now = this.clock();
    return (await this.results.getAll(userId))
      .filter((result) => activeIds.has(result.followId))
      .map((result) =>
        result.expireAt <= now
          ? { ...result, status: 'stale' as const }
          : result,
      );
  }

  async onFollowCreated(follow: WatchingFollow, userId: string): Promise<void> {
    if (!(await this.isBackendEnabled(userId))) return;
    await this.scheduleFollow(userId, follow, true);
  }

  async onFollowUpdated(follow: WatchingFollow, userId: string): Promise<void> {
    if (follow.enabled) {
      if (!(await this.isBackendEnabled(userId))) return;
      await this.scheduleFollow(userId, follow, false);
    } else {
      await this.removeFollow(userId, follow);
    }
  }

  async onFollowDeleted(
    userId: string,
    source: string,
    id: string,
  ): Promise<void> {
    const followId = watchingFollowStorageKey(source, id);
    await Promise.all([
      this.results.delete(userId, followId),
      this.observations.delete(userId, followId),
      this.tasks.delete(updateCheckTaskId(userId, followId)),
    ]);
  }

  async checkUser(
    userId: string,
    followIds?: string[],
  ): Promise<UpdateCheckBatch> {
    if (!(await this.isBackendEnabled(userId)))
      return { results: [], errors: [] };
    const follows = Object.values(
      await this.facts.getAllWatchingFollows(userId),
    ).filter(
      (follow) =>
        follow.enabled &&
        (!followIds ||
          followIds.includes(
            watchingFollowStorageKey(follow.source, follow.id),
          )),
    );
    const results: UpdateResult[] = [];
    const errors: Array<{ followId: string; error: string }> = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < follows.length) {
        const follow = follows[cursor++];
        const followId = watchingFollowStorageKey(follow.source, follow.id);
        try {
          await this.scheduleFollow(userId, follow, false);
          const result = await this.checkFollow(userId, follow);
          if (result) results.push(result);
        } catch (error) {
          errors.push({ followId, error: errorMessage(error) });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(5, follows.length) }, worker),
    );
    return { results, errors };
  }

  async processObservation(
    observation: UpdateObservation,
  ): Promise<UpdateResult | null> {
    if (!(await this.isBackendEnabled(observation.userId))) return null;
    const identity = await this.resolveObservationFollow(observation);
    if (!identity) return null;
    const latestEpisode = normalizeEpisode(observation.latestEpisode);
    if (latestEpisode <= 0) return null;

    await this.scheduleFollow(observation.userId, identity.follow, false);
    const previousObservation = await this.observations.get(
      observation.userId,
      observation.followId,
    );
    if (
      previousObservation &&
      observation.observedAt < previousObservation.observedAt
    ) {
      return this.results.get(observation.userId, observation.followId);
    }
    await this.observations.save({ ...observation, latestEpisode });
    return this.calculateAndSave(
      observation.userId,
      identity.follow,
      latestEpisode,
      this.clock(),
    );
  }

  async checkTask(task: UpdateCheckTask): Promise<UpdateResult | null> {
    if (!(await this.isBackendEnabled(task.userId))) return null;
    const follow = await this.facts.getWatchingFollow(
      task.userId,
      task.source,
      task.resourceId,
    );
    if (!follow || !follow.enabled) {
      await this.onFollowDeleted(task.userId, task.source, task.resourceId);
      return null;
    }

    try {
      const snapshot = await (await this.getProviders())
        .get(task.source)
        .getLatestEpisode({
          userId: task.userId,
          source: task.source,
          resourceId: task.resourceId,
          title: follow.title,
        });
      const latestEpisode = normalizeEpisode(snapshot.latestEpisode);
      if (latestEpisode <= 0) throw new Error('Latest episode count is empty');
      return await this.calculateAndSave(
        task.userId,
        follow,
        latestEpisode,
        this.clock(),
        snapshot.metadata,
      );
    } catch (error) {
      await this.markTaskFailure(task, error);
      return null;
    }
  }

  private async checkFollow(
    userId: string,
    follow: WatchingFollow,
  ): Promise<UpdateResult | null> {
    const task = await this.tasks.get(
      updateCheckTaskId(
        userId,
        watchingFollowStorageKey(follow.source, follow.id),
      ),
    );
    if (!task) return null;
    return this.checkTask(task);
  }

  private async calculateAndSave(
    userId: string,
    follow: WatchingFollow,
    latestEpisode: number,
    checkedAt: number,
    providerMetadata?: {
      sourceName?: string;
      cover?: string;
      year?: string;
      type?: string;
    },
  ): Promise<UpdateResult | null> {
    const record = await this.facts.getPlayRecord(
      userId,
      follow.source,
      follow.id,
    );
    if (!record) {
      // A follow can exist before its first playback fact. Keep the task on
      // its normal cadence without manufacturing an UpdateResult.
      await this.markTaskSuccess(userId, follow, checkedAt);
      return null;
    }

    const watchedEpisode = watchedEpisodesForRecord(
      record,
      DEFAULT_WATCH_COMPLETION_THRESHOLD,
    );
    const calculation = calculateWatchingUpdate({
      detailEpisodes: latestEpisode,
      originalEpisodes: follow.originalEpisodes,
      recordTotalEpisodes: record.total_episodes,
      watchedEpisodes: watchedEpisode,
    });
    const followId = watchingFollowStorageKey(follow.source, follow.id);
    const previous = await this.results.get(userId, followId);
    const result: UpdateResult = {
      userId,
      followId,
      source: follow.source,
      resourceId: follow.id,
      title: follow.title || record.title,
      // Preserve the latest successful provider observation exactly. The
      // protected value used for calculations is stored separately in metadata.
      latestEpisode,
      watchedEpisode: calculation.watchedEpisodes,
      unwatchedCount: calculation.remainingEpisodes,
      hasUpdate: calculation.hasUpdate,
      checkedAt,
      expireAt: checkedAt + DEFAULT_UPDATE_CHECK_EXPIRE_MS,
      status: 'fresh',
      revision: (previous?.revision ?? 0) + 1,
      metadata: {
        algorithmVersion: UPDATE_CHECK_ALGORITHM_VERSION,
        completionThreshold: DEFAULT_WATCH_COMPLETION_THRESHOLD,
        baselineEpisode: calculation.baselineEpisodes,
        effectiveLatestEpisode: calculation.latestEpisodes,
        releasedEpisodeCount: calculation.newEpisodes,
        sourceName: providerMetadata?.sourceName ?? record.source_name,
        cover: providerMetadata?.cover ?? follow.cover ?? record.cover,
        year: providerMetadata?.year ?? follow.year ?? record.year,
        type: providerMetadata?.type ?? follow.type ?? record.type,
      },
    };
    await this.results.save(result);
    await this.markTaskSuccess(userId, follow, checkedAt);
    return result;
  }

  private async resolveObservationFollow(observation: UpdateObservation) {
    const follow = await this.facts.getWatchingFollow(
      observation.userId,
      observation.source,
      observation.resourceId,
    );
    if (!follow || !follow.enabled) return null;
    const followId = watchingFollowStorageKey(follow.source, follow.id);
    return followId === observation.followId ? { follow } : null;
  }

  private async scheduleFollow(
    userId: string,
    follow: WatchingFollow,
    clearResult: boolean,
  ): Promise<void> {
    const now = this.clock();
    const followId = watchingFollowStorageKey(follow.source, follow.id);
    if (clearResult) {
      await Promise.all([
        this.results.delete(userId, followId),
        this.observations.delete(userId, followId),
      ]);
    }
    const id = updateCheckTaskId(userId, followId);
    const existing = await this.tasks.get(id);
    await this.tasks.save({
      id,
      userId,
      followId,
      source: follow.source,
      resourceId: follow.id,
      nextCheckAt: clearResult
        ? now
        : Math.min(existing?.nextCheckAt ?? now, now),
      attempt: existing?.attempt ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSuccessAt: existing?.lastSuccessAt,
      lastErrorAt: existing?.lastErrorAt,
      lastError: existing?.lastError,
    });
  }

  private async ensureTask(
    userId: string,
    follow: WatchingFollow,
  ): Promise<void> {
    const followId = watchingFollowStorageKey(follow.source, follow.id);
    const id = updateCheckTaskId(userId, followId);
    if (await this.tasks.get(id)) return;
    const now = this.clock();
    await this.tasks.save({
      id,
      userId,
      followId,
      source: follow.source,
      resourceId: follow.id,
      nextCheckAt: now,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async removeFollow(
    userId: string,
    follow: WatchingFollow,
  ): Promise<void> {
    await this.onFollowDeleted(userId, follow.source, follow.id);
  }

  private async markTaskSuccess(
    userId: string,
    follow: WatchingFollow,
    checkedAt: number,
  ): Promise<void> {
    const id = updateCheckTaskId(
      userId,
      watchingFollowStorageKey(follow.source, follow.id),
    );
    const current = await this.tasks.get(id);
    if (!current) return;
    const config = await this.config.getUpdateCheckConfig();
    await this.tasks.save({
      ...current,
      nextCheckAt: checkedAt + config.updateCheckCronInterval,
      attempt: 0,
      updatedAt: checkedAt,
      lastSuccessAt: checkedAt,
      lastError: undefined,
    });
  }

  private async markTaskFailure(
    task: UpdateCheckTask,
    error: unknown,
  ): Promise<void> {
    const now = this.clock();
    const attempt = task.attempt + 1;
    const delay = Math.min(
      6 * 60 * 60 * 1000,
      5 * 60 * 1000 * 2 ** Math.min(attempt - 1, 6),
    );
    await this.tasks.save({
      ...task,
      attempt,
      nextCheckAt: now + delay,
      updatedAt: now,
      lastErrorAt: now,
      lastError: errorMessage(error),
    });
  }

  private async getProviders(): Promise<LatestEpisodeProviderRegistry> {
    if (!this.providers) {
      const module = await import('./latest-episode-provider');
      this.providers = module.latestEpisodeProviderRegistry;
    }
    return this.providers;
  }

  async onUserPermissionEnabled(userId: string): Promise<void> {
    if (!(await this.isBackendEnabled(userId))) return;
    const config = await this.config.getUpdateCheckConfig();
    const follows = Object.values(
      await this.facts.getAllWatchingFollows(userId),
    )
      .filter((follow) => follow.enabled)
      .slice(0, config.updateCheckMaxFollowPerUser);
    await Promise.all(follows.map((follow) => this.ensureTask(userId, follow)));
  }

  async onUserPermissionDisabled(userId: string): Promise<void> {
    await Promise.all([
      this.results.deleteForUser(userId),
      this.observations.deleteForUser(userId),
      this.tasks.deleteForUser(userId),
    ]);
  }

  private async isBackendEnabled(userId: string): Promise<boolean> {
    return (await this.capability.getCapability(userId)).enabled;
  }
}

export const updateCheckService = new UpdateCheckService();
