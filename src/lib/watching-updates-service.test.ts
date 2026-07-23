import type { WatchingUpdatesRepositoryContract } from './api/watching-updates';
import type { UpdateResult } from './update-check-types';
import {
  mapUpdateResults,
  WatchingUpdatesService,
} from './watching-updates-service';

function repository(): jest.Mocked<WatchingUpdatesRepositoryContract> {
  return {
    getCapability: jest.fn(),
    getResults: jest.fn(),
    check: jest.fn(),
    sync: jest.fn(),
  };
}

describe('WatchingUpdatesService', () => {
  it('keeps the default local mode completely offline from backend APIs', async () => {
    const repo = repository();
    const service = new WatchingUpdatesService(repo);

    await expect(service.resolveMode('local')).resolves.toMatchObject({
      effectiveMode: 'local',
      capabilityState: 'idle',
    });
    expect(repo.getCapability).not.toHaveBeenCalled();
    expect(repo.getResults).not.toHaveBeenCalled();
  });

  it.each([
    [{ supported: false, enabled: false, userAllowed: false }, 'unsupported'],
    [{ supported: true, enabled: false, userAllowed: false }, 'disabled'],
    [{ supported: true, enabled: true, userAllowed: false }, 'unauthorized'],
  ])('downgrades backend when capability is %s', async (fields) => {
    const repo = repository();
    repo.getCapability.mockResolvedValue({
      ...fields,
      mode: 'local',
    });
    const service = new WatchingUpdatesService(repo);

    await expect(service.resolveMode('backend')).resolves.toMatchObject({
      effectiveMode: 'local',
      capabilityState: 'unavailable',
    });
    expect(repo.getResults).not.toHaveBeenCalled();
  });

  it('enables backend only when all capability fields allow it', async () => {
    const repo = repository();
    repo.getCapability.mockResolvedValue({
      supported: true,
      enabled: true,
      userAllowed: true,
      mode: 'backend',
    });
    const service = new WatchingUpdatesService(repo);

    await expect(service.resolveMode('backend')).resolves.toMatchObject({
      effectiveMode: 'backend',
      capabilityState: 'available',
    });
  });

  it('maps UpdateResult without treating it as a client-owned fact', () => {
    const snapshot = mapUpdateResults([createResult()], 2000);

    expect(snapshot.freshness).toBe('fresh');
    expect(snapshot.data).toMatchObject({
      timestamp: 2000,
      updatedCount: 1,
      updatedSeries: [
        expect.objectContaining({
          latestEpisodes: 12,
          currentEpisode: 8,
          newEpisodes: 2,
          remainingEpisodes: 4,
          detectedAt: 1500,
        }),
      ],
    });
  });
});

function createResult(): UpdateResult {
  return {
    userId: 'alice',
    followId: '["source-a","video-1"]',
    source: 'source-a',
    resourceId: 'video-1',
    title: 'Server Demo',
    latestEpisode: 12,
    watchedEpisode: 8,
    unwatchedCount: 4,
    hasUpdate: true,
    detectedAt: 1500,
    checkedAt: 2000,
    expireAt: 3000,
    status: 'fresh',
    revision: 1,
    metadata: {
      algorithmVersion: 1,
      completionThreshold: 0.9,
      baselineEpisode: 10,
      effectiveLatestEpisode: 12,
      releasedEpisodeCount: 2,
      sourceName: 'Source A',
      cover: 'cover.jpg',
      year: '2026',
      type: 'tv',
    },
  };
}
