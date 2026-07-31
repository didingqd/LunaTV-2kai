/** @jest-environment node */

jest.mock('./latest-episode-provider', () => ({
  latestEpisodeProviderRegistry: { get: jest.fn() },
}));

import type { PlayRecord, WatchingFollow } from './types';
import type {
  LatestEpisodeProvider,
  LatestEpisodeProviderRegistry,
} from './latest-episode-provider';
import { UpdateCheckService } from './update-check-service';
import type {
  UpdateCheckTask,
  UpdateObservation,
  UpdateResult,
} from './update-check-types';
import type {
  UpdateCheckTaskRepository,
  UpdateObservationRepository,
  UpdateResultRepository,
  WatchingUpdateNotificationStateRepository,
} from './update-check-repository';
import type { UpdateFactsRepository } from './update-check-service';
import type { WatchingUpdateNotificationState } from './watching-update-notification-types';

const follow: WatchingFollow = {
  source: 'source-a',
  id: 'video-1',
  title: 'Demo',
  cover: 'cover.jpg',
  year: '2026',
  type: 'tv',
  originalEpisodes: 10,
  createdAt: 1,
  updatedAt: 1,
  enabled: true,
};

const record: PlayRecord = {
  title: 'Demo',
  source_name: 'Source A',
  cover: 'cover.jpg',
  year: '2026',
  index: 8,
  total_episodes: 10,
  play_time: 1200,
  total_time: 1200,
  save_time: 1,
  search_title: 'Demo',
};

class MemoryResults implements UpdateResultRepository {
  values = new Map<string, UpdateResult>();
  async getAll(userId: string) {
    return [...this.values.values()].filter((value) => value.userId === userId);
  }
  async get(userId: string, followId: string) {
    const value = this.values.get(`${userId}:${followId}`);
    return value ?? null;
  }
  async save(value: UpdateResult) {
    this.values.set(`${value.userId}:${value.followId}`, value);
  }
  async delete(userId: string, followId: string) {
    this.values.delete(`${userId}:${followId}`);
  }
  async deleteForUser(userId: string) {
    for (const key of this.values.keys())
      if (key.startsWith(`${userId}:`)) this.values.delete(key);
  }
}

class MemoryObservations implements UpdateObservationRepository {
  values = new Map<string, UpdateObservation>();
  async get(userId: string, followId: string) {
    return this.values.get(`${userId}:${followId}`) ?? null;
  }
  async save(value: UpdateObservation) {
    this.values.set(`${value.userId}:${value.followId}`, value);
  }
  async delete(userId: string, followId: string) {
    this.values.delete(`${userId}:${followId}`);
  }
  async deleteForUser(userId: string) {
    for (const key of this.values.keys())
      if (key.startsWith(`${userId}:`)) this.values.delete(key);
  }
}

class MemoryNotificationState implements WatchingUpdateNotificationStateRepository {
  values = new Map<string, WatchingUpdateNotificationState>();

  async get(userId: string) {
    return this.values.get(userId) ?? { snapshots: [], history: [] };
  }
  async save(userId: string, state: WatchingUpdateNotificationState) {
    this.values.set(userId, state);
  }
  async deleteForFollow(userId: string, followId: string) {
    const state = await this.get(userId);
    this.values.set(userId, {
      snapshots: state.snapshots.filter(
        (snapshot) => snapshot.followId !== followId,
      ),
      history: state.history.filter((item) => item.followId !== followId),
    });
  }
  async deleteForUser(userId: string) {
    this.values.delete(userId);
  }
}

class MemoryTasks implements UpdateCheckTaskRepository {
  values = new Map<string, UpdateCheckTask>();
  async get(id: string) {
    return this.values.get(id) ?? null;
  }
  async save(value: UpdateCheckTask) {
    this.values.set(value.id, value);
  }
  async listDue(now: number, limit: number) {
    return [...this.values.values()]
      .filter((value) => value.nextCheckAt <= now)
      .slice(0, limit);
  }
  async delete(id: string) {
    this.values.delete(id);
  }
  async deleteForUser(userId: string) {
    for (const [key, value] of this.values)
      if (value.userId === userId) this.values.delete(key);
  }
}

class MemoryFacts implements UpdateFactsRepository {
  playRecord: PlayRecord | null = record;
  watchingFollow: WatchingFollow | null = follow;

  async getWatchingFollow() {
    return this.watchingFollow;
  }
  async getAllWatchingFollows() {
    return this.watchingFollow ? { follow: this.watchingFollow } : {};
  }
  async getPlayRecord() {
    return this.playRecord;
  }
}

describe('UpdateCheckService', () => {
  let latestEpisode = 12;
  let now = 1000;
  let shouldFail = false;
  let results: MemoryResults;
  let observations: MemoryObservations;
  let tasks: MemoryTasks;
  let notificationState: MemoryNotificationState;
  let facts: MemoryFacts;
  let service: UpdateCheckService;
  let thresholdByUser: Map<string, number>;

  beforeEach(async () => {
    latestEpisode = 12;
    now = 1000;
    shouldFail = false;
    results = new MemoryResults();
    observations = new MemoryObservations();
    tasks = new MemoryTasks();
    notificationState = new MemoryNotificationState();
    facts = new MemoryFacts();
    thresholdByUser = new Map();
    const provider: LatestEpisodeProvider = {
      supports: () => true,
      getLatestEpisode: async () => {
        if (shouldFail) throw new Error('upstream unavailable');
        return { latestEpisode };
      },
    };
    service = new UpdateCheckService({
      facts,
      results,
      observations,
      tasks,
      notificationState,
      providers: {
        get: () => provider,
      } as unknown as LatestEpisodeProviderRegistry,
      capability: {
        getCapability: async () => ({
          enabled: true,
          backendEnabled: true,
          userEnabled: true,
          mode: 'backend',
        }),
      },
      completionThreshold: {
        getWatchCompletionThreshold: async (userId) =>
          thresholdByUser.get(userId) ?? 80,
      },
      config: {
        getUpdateCheckConfig: async () => ({
          updateCheckBackendEnabled: true,
          updateCheckSchedulerEnabled: true,
          updateCheckCronExpression: '*/30 * * * *',
          updateCheckTimezone: 'UTC',
          updateCheckLogRetentionCount: 200,
          updateCheckBatchSize: 100,
          updateCheckMaxUsers: 1000,
          updateCheckMaxFollowPerUser: 100,
        }),
      },
      loadAdminConfig: async () =>
        ({
          UserConfig: {
            Users: [
              {
                username: 'alice',
                role: 'user',
                updateCheckBackendEnabled: true,
              },
            ],
          },
        }) as never,
      now: () => now,
    });
    await service.onFollowCreated(follow, 'alice');
  });

  it('sets detectedAt when an update is first confirmed', async () => {
    const task = [...tasks.values.values()][0];

    const result = await service.checkTask(task);

    expect(result?.metadata.releasedEpisodeCount).toBe(2);
    expect(result?.detectedAt).toBe(1000);
  });

  it('keeps detectedAt when the update count is unchanged', async () => {
    const task = [...tasks.values.values()][0];
    await service.checkTask(task);
    now = 2000;

    const result = await service.checkTask(task);

    expect(result?.metadata.releasedEpisodeCount).toBe(2);
    expect(result?.detectedAt).toBe(1000);
  });

  it('refreshes detectedAt when the update count increases', async () => {
    const task = [...tasks.values.values()][0];
    await service.checkTask(task);
    latestEpisode = 14;
    now = 2000;

    const result = await service.checkTask(task);

    expect(result?.metadata.releasedEpisodeCount).toBe(4);
    expect(result?.detectedAt).toBe(2000);
  });

  it('clears detectedAt after playback catches up', async () => {
    const task = [...tasks.values.values()][0];
    await service.checkTask(task);
    latestEpisode = 10;
    now = 2000;

    const result = await service.checkTask(task);

    expect(result?.metadata.releasedEpisodeCount).toBe(0);
    expect(result?.detectedAt).toBeUndefined();
  });

  it('creates a new detectedAt when updates return after being cleared', async () => {
    const task = [...tasks.values.values()][0];
    await service.checkTask(task);
    latestEpisode = 10;
    now = 2000;
    await service.checkTask(task);
    latestEpisode = 12;
    now = 3000;

    const result = await service.checkTask(task);

    expect(result?.metadata.releasedEpisodeCount).toBe(2);
    expect(result?.detectedAt).toBe(3000);
  });

  it('allows a successful lower episode observation to replace the previous result', async () => {
    const task = [...tasks.values.values()][0];
    await service.checkTask(task);
    latestEpisode = 10;
    await service.checkTask(task);

    expect((await results.get('alice', task.followId))?.latestEpisode).toBe(10);
  });

  it('does not recalculate from an older Observation timestamp', async () => {
    const task = [...tasks.values.values()][0];
    await service.processObservation({
      userId: 'alice',
      followId: task.followId,
      source: follow.source,
      resourceId: follow.id,
      latestEpisode: 12,
      observedAt: 2000,
    });
    await service.processObservation({
      userId: 'alice',
      followId: task.followId,
      source: follow.source,
      resourceId: follow.id,
      latestEpisode: 8,
      observedAt: 1000,
    });

    expect((await results.get('alice', task.followId))?.latestEpisode).toBe(12);
  });

  it('does not overwrite the last successful result when the provider fails', async () => {
    const task = [...tasks.values.values()][0];
    await service.checkTask(task);
    shouldFail = true;
    await service.checkTask(task);

    expect((await results.get('alice', task.followId))?.latestEpisode).toBe(12);
    expect((await tasks.get(task.id))?.lastError).toBe('upstream unavailable');
  });

  it('recalculates an UpdateResult from an Observation', async () => {
    const task = [...tasks.values.values()][0];
    const result = await service.processObservation({
      userId: 'alice',
      followId: task.followId,
      source: follow.source,
      resourceId: follow.id,
      latestEpisode: 11,
      observedAt: 1000,
    });

    expect(result?.latestEpisode).toBe(11);
    expect(
      (await observations.get('alice', task.followId))?.latestEpisode,
    ).toBe(11);
  });

  it('ensures an UpdateCheckTask exists when an Observation arrives', async () => {
    const task = [...tasks.values.values()][0];
    tasks.values.clear();

    await service.processObservation({
      userId: 'alice',
      followId: task.followId,
      source: follow.source,
      resourceId: follow.id,
      latestEpisode: 11,
      observedAt: 1000,
    });

    expect(tasks.values.size).toBe(1);
  });

  it('reschedules a successful provider check when PlayRecord is absent', async () => {
    const task = [...tasks.values.values()][0];
    facts.playRecord = null;

    expect(await service.checkTask(task)).toBeNull();
    expect((await tasks.get(task.id))?.nextCheckAt).toBe(
      new Date('1970-01-01T00:30:00.000Z').getTime(),
    );
    expect(await results.get('alice', task.followId)).toBeNull();
  });

  it('removes cached update and notification state when a follow is disabled', async () => {
    const task = [...tasks.values.values()][0];
    await service.checkTask(task);
    await notificationState.save('alice', {
      snapshots: [{ followId: task.followId, episode: 12 }],
      history: [
        {
          followId: task.followId,
          fromEpisode: 10,
          toEpisode: 12,
          updatedAt: '2026-07-31T12:00:00.000Z',
        },
      ],
    });
    await service.onFollowUpdated({ ...follow, enabled: false }, 'alice');

    expect(await results.get('alice', task.followId)).toBeNull();
    expect(await observations.get('alice', task.followId)).toBeNull();
    expect(await tasks.get(task.id)).toBeNull();
    expect(await notificationState.get('alice')).toEqual({
      snapshots: [],
      history: [],
    });
  });

  it('cleans update and notification state when user permission is disabled', async () => {
    const task = [...tasks.values.values()][0];
    await service.processObservation({
      userId: 'alice',
      followId: task.followId,
      source: follow.source,
      resourceId: follow.id,
      latestEpisode: 11,
      observedAt: 1000,
    });
    await notificationState.save('alice', {
      snapshots: [{ followId: task.followId, episode: 11 }],
      history: [],
    });

    await service.onUserPermissionDisabled('alice');

    expect(await results.get('alice', task.followId)).toBeNull();
    expect(await observations.get('alice', task.followId)).toBeNull();
    expect(await tasks.get(task.id)).toBeNull();
    expect(await notificationState.get('alice')).toEqual({
      snapshots: [],
      history: [],
    });
  });

  it('clears notification state before scheduling a newly created follow', async () => {
    const task = [...tasks.values.values()][0];
    await notificationState.save('alice', {
      snapshots: [{ followId: task.followId, episode: 12 }],
      history: [
        {
          followId: task.followId,
          fromEpisode: 10,
          toEpisode: 12,
          updatedAt: '2026-07-31T12:00:00.000Z',
        },
      ],
    });

    await service.onFollowCreated(follow, 'alice');

    expect(await notificationState.get('alice')).toEqual({
      snapshots: [],
      history: [],
    });
  });

  it('cleans notification state when a scheduled follow no longer exists', async () => {
    const task = [...tasks.values.values()][0];
    await notificationState.save('alice', {
      snapshots: [{ followId: task.followId, episode: 12 }],
      history: [
        {
          followId: task.followId,
          fromEpisode: 10,
          toEpisode: 12,
          updatedAt: '2026-07-31T12:00:00.000Z',
        },
      ],
    });
    facts.watchingFollow = null;

    await service.checkTask(task);

    expect(await tasks.get(task.id)).toBeNull();
    expect(await notificationState.get('alice')).toEqual({
      snapshots: [],
      history: [],
    });
  });

  it('does not create task, observation or result when capability is local', async () => {
    const localTasks = new MemoryTasks();
    const localService = new UpdateCheckService({
      facts,
      results,
      observations,
      tasks: localTasks,
      notificationState,
      capability: {
        getCapability: async () => ({
          enabled: false,
          backendEnabled: true,
          userEnabled: false,
          mode: 'local',
          reason: 'user_not_enabled',
        }),
      },
      now: () => 1000,
    });
    await localService.onFollowCreated(follow, 'alice');
    const result = await localService.processObservation({
      userId: 'alice',
      followId: 'follow-1',
      source: follow.source,
      resourceId: follow.id,
      latestEpisode: 11,
      observedAt: 1000,
    });

    expect(localTasks.values.size).toBe(0);
    expect(observations.values.size).toBe(0);
    expect(results.values.size).toBe(0);
    expect(result).toBeNull();
  });

  it('uses the default 80 percent completion threshold', async () => {
    const task = [...tasks.values.values()][0];

    const result = await service.checkTask(task);

    expect(result?.metadata.completionThreshold).toBe(80);
  });

  it('uses the current user threshold when calculating watched episodes', async () => {
    thresholdByUser.set('alice', 50);
    latestEpisode = 9;
    facts.watchingFollow = { ...follow, originalEpisodes: 7 };
    facts.playRecord = {
      ...record,
      total_episodes: 9,
      play_time: 500,
      total_time: 1000,
    };
    const task = [...tasks.values.values()][0];

    const result = await service.checkTask(task);

    expect(result?.watchedEpisode).toBe(8);
    expect(result?.metadata.completionThreshold).toBe(50);
    expect(result?.metadata.releasedEpisodeCount).toBe(1);
  });

  it('keeps user completion thresholds isolated', async () => {
    thresholdByUser.set('alice', 50);
    thresholdByUser.set('bob', 90);
    latestEpisode = 9;
    facts.watchingFollow = { ...follow, originalEpisodes: 7 };
    facts.playRecord = {
      ...record,
      total_episodes: 9,
      play_time: 500,
      total_time: 1000,
    };
    await service.onFollowCreated(facts.watchingFollow, 'bob');
    const aliceTask = [...tasks.values.values()].find(
      (task) => task.userId === 'alice',
    )!;
    const bobTask = [...tasks.values.values()].find(
      (task) => task.userId === 'bob',
    )!;

    const aliceResult = await service.checkTask(aliceTask);
    const bobResult = await service.checkTask(bobTask);

    expect(aliceResult?.watchedEpisode).toBe(8);
    expect(aliceResult?.metadata.completionThreshold).toBe(50);
    expect(bobResult?.watchedEpisode).toBe(7);
    expect(bobResult?.metadata.completionThreshold).toBe(90);
  });
});
