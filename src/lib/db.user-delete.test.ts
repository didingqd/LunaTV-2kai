import { DbManager } from './db';
import type { IStorage } from './types';
import {
  CachedUpdateCheckTaskRepository,
  CachedUpdateObservationRepository,
  CachedUpdateResultRepository,
  updateCheckTaskId,
} from './update-check-repository';
import type {
  UpdateCheckTask,
  UpdateObservation,
  UpdateResult,
} from './update-check-types';

jest.mock('./kvrocks.db', () => ({ KvrocksStorage: jest.fn() }));
jest.mock('./redis.db', () => ({ RedisStorage: jest.fn() }));
jest.mock('./sqlite.db', () => ({ SqliteStorage: jest.fn() }));
jest.mock('./upstash.db', () => ({ UpstashRedisStorage: jest.fn() }));

describe('DbManager user deletion lifecycle', () => {
  it('removes only the deleted user video remarks cache', async () => {
    const cache = new Map<string, unknown>([
      ['user:alice:video_remarks', { abc__123: { remark: 'A' } }],
      ['user:bob:video_remarks', { abc__123: { remark: 'B' } }],
    ]);
    const storage = createStorage(cache);
    const db = new DbManager(storage as unknown as IStorage);

    await db.deleteUser('alice');

    expect(storage.deleteUser).toHaveBeenCalledWith('alice');
    expect(storage.deleteCache).toHaveBeenCalledWith(
      'user:alice:video_remarks',
    );
    expect(cache.has('user:alice:video_remarks')).toBe(false);
    expect(cache.get('user:bob:video_remarks')).toEqual({
      abc__123: { remark: 'B' },
    });
  });

  it('removes deleted user update-check result observation and task state', async () => {
    const cache = new Map<string, unknown>();
    const storage = createStorage(cache);
    const db = new DbManager(storage as unknown as IStorage);
    const results = new CachedUpdateResultRepository(storage);
    const observations = new CachedUpdateObservationRepository(storage);
    const tasks = new CachedUpdateCheckTaskRepository(storage);
    const aliceTask = task('alice', 'main+demo', 100);

    await results.save(result('alice', 'main+demo'));
    await observations.save(observation('alice', 'main+demo'));
    await tasks.save(aliceTask);

    await db.deleteUser('alice');

    expect(await results.getAll('alice')).toEqual([]);
    expect(await observations.get('alice', 'main+demo')).toBeNull();
    expect(await tasks.get(aliceTask.id)).toBeNull();
    expect(await tasks.listDue(100, 10)).toEqual([]);
  });

  it('keeps other users update-check cache when deleting one user', async () => {
    const cache = new Map<string, unknown>();
    const storage = createStorage(cache);
    const db = new DbManager(storage as unknown as IStorage);
    const results = new CachedUpdateResultRepository(storage);
    const observations = new CachedUpdateObservationRepository(storage);
    const tasks = new CachedUpdateCheckTaskRepository(storage);
    const aliceTask = task('alice', 'main+alice', 100);
    const bobTask = task('bob', 'main+bob', 100);

    await results.save(result('alice', 'main+alice'));
    await results.save(result('bob', 'main+bob'));
    await observations.save(observation('alice', 'main+alice'));
    await observations.save(observation('bob', 'main+bob'));
    await tasks.save(aliceTask);
    await tasks.save(bobTask);

    await db.deleteUser('alice');

    expect(await results.getAll('alice')).toEqual([]);
    expect((await results.getAll('bob')).map((item) => item.followId)).toEqual([
      'main+bob',
    ]);
    expect(await observations.get('alice', 'main+alice')).toBeNull();
    expect(await observations.get('bob', 'main+bob')).toMatchObject({
      userId: 'bob',
      followId: 'main+bob',
    });
    expect(await tasks.get(aliceTask.id)).toBeNull();
    expect(await tasks.get(bobTask.id)).toEqual(bobTask);
    expect((await tasks.listDue(100, 10)).map((item) => item.userId)).toEqual([
      'bob',
    ]);
  });

  it('does not throw when deleting a missing user', async () => {
    const cache = new Map<string, unknown>();
    const storage = createStorage(cache);
    const db = new DbManager(storage as unknown as IStorage);

    await expect(db.deleteUser('missing')).resolves.toBeUndefined();

    expect(storage.deleteUser).toHaveBeenCalledWith('missing');
  });
});

function createStorage(cache: Map<string, unknown>) {
  return {
    deleteUser: jest.fn(),
    getCache: jest.fn(async (key: string) => cache.get(key) ?? null),
    setCache: jest.fn(async (key: string, value: unknown) => {
      cache.set(key, value);
    }),
    deleteCache: jest.fn(async (key: string) => {
      cache.delete(key);
    }),
  };
}

function result(userId: string, followId: string): UpdateResult {
  return {
    userId,
    followId,
    source: 'main',
    resourceId: followId,
    title: 'Demo',
    latestEpisode: 12,
    watchedEpisode: 10,
    unwatchedCount: 2,
    hasUpdate: true,
    checkedAt: 1,
    expireAt: 1000,
    status: 'fresh',
    revision: 1,
    metadata: {
      algorithmVersion: 1,
      completionThreshold: 0.9,
      baselineEpisode: 10,
      effectiveLatestEpisode: 12,
      releasedEpisodeCount: 2,
    },
  };
}

function observation(userId: string, followId: string): UpdateObservation {
  return {
    userId,
    followId,
    source: 'main',
    resourceId: followId,
    latestEpisode: 12,
    observedAt: 1,
  };
}

function task(
  userId: string,
  followId: string,
  nextCheckAt: number,
): UpdateCheckTask {
  return {
    id: updateCheckTaskId(userId, followId),
    userId,
    followId,
    source: 'main',
    resourceId: followId,
    nextCheckAt,
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}
