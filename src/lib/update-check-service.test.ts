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
} from './update-check-repository';
import type { UpdateFactsRepository } from './update-check-service';

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

  async getWatchingFollow() {
    return follow;
  }
  async getAllWatchingFollows() {
    return { follow };
  }
  async getPlayRecord() {
    return this.playRecord;
  }
}

describe('UpdateCheckService', () => {
  let latestEpisode = 12;
  let shouldFail = false;
  let results: MemoryResults;
  let observations: MemoryObservations;
  let tasks: MemoryTasks;
  let facts: MemoryFacts;
  let service: UpdateCheckService;

  beforeEach(async () => {
    latestEpisode = 12;
    shouldFail = false;
    results = new MemoryResults();
    observations = new MemoryObservations();
    tasks = new MemoryTasks();
    facts = new MemoryFacts();
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
      providers: {
        get: () => provider,
      } as unknown as LatestEpisodeProviderRegistry,
      now: () => 1000,
    });
    await service.onFollowCreated(follow, 'alice');
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
    expect((await tasks.get(task.id))?.nextCheckAt).toBeGreaterThan(1000);
    expect(await results.get('alice', task.followId)).toBeNull();
  });

  it('removes cached result, observation and task when a follow is disabled', async () => {
    const task = [...tasks.values.values()][0];
    await service.checkTask(task);
    await service.onFollowUpdated({ ...follow, enabled: false }, 'alice');

    expect(await results.get('alice', task.followId)).toBeNull();
    expect(await observations.get('alice', task.followId)).toBeNull();
    expect(await tasks.get(task.id)).toBeNull();
  });
});
