import {
  watchingUpdatesRepository,
  type WatchingUpdateObservationInput,
  type WatchingUpdatesCapabilityResponse,
  type WatchingUpdatesRepositoryContract,
} from './api/watching-updates';
import { normalizeContentIdentity } from './content-identity';
import type { UpdateResult } from './update-check-types';
import type {
  WatchingUpdate,
  WatchingUpdateItem,
} from './watching-update-result';
import type { WatchingUpdateSourceMode } from './watching-update-preference';
import type { WatchingUpdatesFreshness } from './watching-updates-cache';

export type WatchingUpdatesCapabilityState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'error';

export interface WatchingUpdatesModeResolution {
  requestedMode: WatchingUpdateSourceMode;
  effectiveMode: WatchingUpdateSourceMode;
  capabilityState: WatchingUpdatesCapabilityState;
  capability?: WatchingUpdatesCapabilityResponse;
}

export interface BackendWatchingUpdatesSnapshot {
  data: WatchingUpdate;
  freshness: WatchingUpdatesFreshness;
}

export class WatchingUpdatesService {
  constructor(
    private readonly repository: WatchingUpdatesRepositoryContract = watchingUpdatesRepository,
  ) {}

  async resolveMode(
    preference: WatchingUpdateSourceMode,
  ): Promise<WatchingUpdatesModeResolution> {
    if (preference === 'local') {
      return {
        requestedMode: 'local',
        effectiveMode: 'local',
        capabilityState: 'idle',
      };
    }

    try {
      const capability = await this.repository.getCapability();
      const available =
        capability.supported === true &&
        capability.enabled === true &&
        capability.userAllowed === true;
      return {
        requestedMode: 'backend',
        effectiveMode: available ? 'backend' : 'local',
        capabilityState: available ? 'available' : 'unavailable',
        capability,
      };
    } catch {
      return {
        requestedMode: 'backend',
        effectiveMode: 'local',
        capabilityState: 'error',
      };
    }
  }

  async getBackendResults(): Promise<BackendWatchingUpdatesSnapshot> {
    const response = await this.repository.getResults();
    if (
      response.enabled !== true ||
      response.mode !== 'backend' ||
      !Array.isArray(response.results)
    ) {
      throw new Error('Watching Updates backend is unavailable');
    }
    return mapUpdateResults(response.results, response.generatedAt);
  }

  check(followIds?: string[]) {
    return this.repository.check(followIds);
  }

  syncObservations(observations: WatchingUpdateObservationInput[]) {
    if (observations.length === 0) return Promise.resolve(undefined);
    return this.repository.sync(observations).then(() => undefined);
  }
}

export function mapUpdateResults(
  results: UpdateResult[],
  generatedAt: number,
): BackendWatchingUpdatesSnapshot {
  const updatedSeries = results
    .filter((result) => result.hasUpdate)
    .map(mapUpdateResultItem)
    .filter((item): item is WatchingUpdateItem => item !== null);
  const freshness: WatchingUpdatesFreshness = results.some(
    (result) => result.status === 'error',
  )
    ? 'error'
    : results.some((result) => result.status === 'stale')
      ? 'stale'
      : 'fresh';
  const timestamp =
    generatedAt > 0
      ? generatedAt
      : results.reduce(
          (latest, result) => Math.max(latest, result.checkedAt),
          0,
        );

  return {
    freshness,
    data: {
      hasUpdates: updatedSeries.length > 0,
      timestamp,
      updatedCount: updatedSeries.length,
      continueWatchingCount: 0,
      newReleasesCount: 0,
      updatedSeries,
    },
  };
}

function mapUpdateResultItem(result: UpdateResult): WatchingUpdateItem | null {
  const identity = normalizeContentIdentity(result.source, result.resourceId);
  if (!identity) return null;
  const latestEpisodes = Math.max(
    0,
    result.metadata.effectiveLatestEpisode || result.latestEpisode,
  );
  const newEpisodes = Math.max(0, result.metadata.releasedEpisodeCount);
  const remainingEpisodes = Math.max(0, result.unwatchedCount);
  const sourceName = result.metadata.sourceName || result.source;

  return {
    title: result.title,
    sourceName,
    source_name: sourceName,
    year: result.metadata.year || '',
    cover: result.metadata.cover || '',
    identityKey: identity.identityKey,
    source: result.source,
    id: result.resourceId,
    sourceKey: result.source,
    videoId: result.resourceId,
    currentEpisode: Math.max(0, result.watchedEpisode),
    totalEpisodes: latestEpisodes,
    hasNewEpisode: result.hasUpdate,
    hasContinueWatching: false,
    hasNewRelease: false,
    newEpisodes,
    remainingEpisodes,
    releasedEpisodes: newEpisodes,
    unwatchedEpisodes: remainingEpisodes,
    latestEpisodes,
    completed: result.watchedEpisode >= latestEpisodes,
    detectedAt:
      typeof result.detectedAt === 'number' &&
      Number.isFinite(result.detectedAt) &&
      result.detectedAt > 0
        ? Math.floor(result.detectedAt)
        : undefined,
  };
}

export const watchingUpdatesService = new WatchingUpdatesService();
