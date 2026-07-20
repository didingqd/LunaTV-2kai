import { DbManager } from './db';
import { playRecordStorageKey } from './play-record';
import { createWatchingFollow } from './watching-follow';
import type { IStorage, WatchingFollow } from './types';

jest.mock('./kvrocks.db', () => ({ KvrocksStorage: jest.fn() }));
jest.mock('./redis.db', () => ({ RedisStorage: jest.fn() }));
jest.mock('./sqlite.db', () => ({ SqliteStorage: jest.fn() }));
jest.mock('./upstash.db', () => ({ UpstashRedisStorage: jest.fn() }));

const follow = createWatchingFollow({
  source: 'abc',
  id: '123',
  title: 'Demo',
  cover: '',
  year: '2026',
  type: 'tv',
  originalEpisodes: 12,
  createdAt: 1,
  updatedAt: 1,
  enabled: true,
});

describe('DbManager WatchingFollow legacy protection', () => {
  it('lazily copies a matching safe legacy Follow without deleting it', async () => {
    const storage = createStorage();
    storage.getWatchingFollow
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(follow);
    const db = new DbManager(storage as unknown as IStorage);

    await expect(db.getWatchingFollow('alice', 'abc', '123')).resolves.toEqual(
      follow,
    );
    expect(storage.setWatchingFollow).toHaveBeenCalledWith(
      'alice',
      playRecordStorageKey('abc', '123'),
      follow,
    );
    expect(storage.deleteWatchingFollow).not.toHaveBeenCalled();
  });

  it('rejects a legacy Follow whose explicit identity does not match', async () => {
    const storage = createStorage();
    storage.getWatchingFollow
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...follow, id: 'other' });
    const db = new DbManager(storage as unknown as IStorage);

    await expect(
      db.getWatchingFollow('alice', 'abc', '123'),
    ).resolves.toBeNull();
    expect(storage.setWatchingFollow).not.toHaveBeenCalled();
    expect(storage.deleteWatchingFollow).not.toHaveBeenCalled();
  });

  it('does not query or delete a colliding legacy key for plus identities', async () => {
    const storage = createStorage();
    storage.getWatchingFollow.mockResolvedValue(null);
    const db = new DbManager(storage as unknown as IStorage);

    await db.getWatchingFollow('alice', 'a+b', '123');
    await db.deleteWatchingFollow('alice', 'a+b', '123');

    expect(storage.getWatchingFollow).toHaveBeenCalledTimes(1);
    expect(storage.getWatchingFollow).toHaveBeenCalledWith(
      'alice',
      playRecordStorageKey('a+b', '123'),
    );
    expect(storage.deleteWatchingFollow).toHaveBeenCalledTimes(1);
    expect(storage.deleteWatchingFollow).toHaveBeenCalledWith(
      'alice',
      playRecordStorageKey('a+b', '123'),
    );
  });

  it('deletes a safe legacy Follow only when its value confirms identity', async () => {
    const storage = createStorage();
    storage.getWatchingFollow.mockResolvedValue(follow);
    const db = new DbManager(storage as unknown as IStorage);

    await db.deleteWatchingFollow('alice', 'abc', '123');

    expect(storage.deleteWatchingFollow).toHaveBeenCalledWith(
      'alice',
      playRecordStorageKey('abc', '123'),
    );
    expect(storage.deleteWatchingFollow).toHaveBeenCalledWith(
      'alice',
      'abc+123',
    );
  });

  it('keeps a mismatched legacy Follow during deletion', async () => {
    const storage = createStorage();
    storage.getWatchingFollow.mockResolvedValue({ ...follow, id: 'other' });
    const db = new DbManager(storage as unknown as IStorage);

    await db.deleteWatchingFollow('alice', 'abc', '123');

    expect(storage.deleteWatchingFollow).toHaveBeenCalledTimes(1);
    expect(storage.deleteWatchingFollow).toHaveBeenCalledWith(
      'alice',
      playRecordStorageKey('abc', '123'),
    );
  });
});

function createStorage() {
  return {
    getWatchingFollow: jest.fn(),
    setWatchingFollow: jest.fn(),
    getAllWatchingFollows: jest.fn().mockResolvedValue({}),
    deleteWatchingFollow: jest.fn(),
  };
}
