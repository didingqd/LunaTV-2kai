import { buildContentIdentityKey } from './content-identity';
import { DbManager } from './db';
import type { Favorite, IStorage, Reminder } from './types';

jest.mock('./kvrocks.db', () => ({ KvrocksStorage: jest.fn() }));
jest.mock('./redis.db', () => ({ RedisStorage: jest.fn() }));
jest.mock('./sqlite.db', () => ({ SqliteStorage: jest.fn() }));
jest.mock('./upstash.db', () => ({ UpstashRedisStorage: jest.fn() }));

const favorite: Favorite = {
  title: 'Demo',
  source_name: 'Source',
  year: '2026',
  cover: '',
  total_episodes: 12,
  save_time: 1,
  search_title: 'Demo',
};

const reminder: Reminder = {
  ...favorite,
  releaseDate: '2026-08-01',
};

describe('DbManager Favorite/Reminder identity migration', () => {
  it('writes new Favorite and Reminder records with canonical keys', async () => {
    const storage = createStorage();
    const db = new DbManager(storage as unknown as IStorage);
    const key = buildContentIdentityKey('a+b', '123+456');

    await db.saveFavorite('alice', 'a+b', '123+456', favorite);
    await db.saveReminder('alice', 'a+b', '123+456', reminder);

    expect(storage.setFavorite).toHaveBeenCalledWith('alice', key, favorite);
    expect(storage.setReminder).toHaveBeenCalledWith('alice', key, reminder);
  });

  it('lazily migrates a legacy Favorite after a canonical miss', async () => {
    const storage = createStorage();
    storage.getFavorite.mockResolvedValue(null);
    storage.getAllFavorites.mockResolvedValue({
      'bangumi+123+456': favorite,
    });
    const db = new DbManager(storage as unknown as IStorage);
    const key = buildContentIdentityKey('bangumi', '123+456');

    await expect(db.getFavorite('alice', 'bangumi', '123+456')).resolves.toBe(
      favorite,
    );
    expect(storage.setFavorite).toHaveBeenCalledWith('alice', key, favorite);
    expect(storage.deleteFavorite).toHaveBeenCalledWith(
      'alice',
      'bangumi+123+456',
    );
  });

  it('keeps canonical Favorite data when canonical and legacy keys coexist', async () => {
    const storage = createStorage();
    const key = buildContentIdentityKey('bangumi', '123');
    const canonical = { ...favorite, title: 'Canonical' };
    storage.getAllFavorites.mockResolvedValue({
      'bangumi+123': { ...favorite, title: 'Legacy' },
      [key]: canonical,
    });
    const db = new DbManager(storage as unknown as IStorage);

    await expect(db.getAllFavorites('alice')).resolves.toEqual({
      [key]: canonical,
    });
    expect(storage.setFavorite).not.toHaveBeenCalled();
    expect(storage.deleteFavorite).toHaveBeenCalledWith('alice', 'bangumi+123');
  });

  it('lazily migrates a legacy Reminder after a canonical miss', async () => {
    const storage = createStorage();
    storage.getReminder.mockResolvedValue(null);
    storage.getAllReminders.mockResolvedValue({
      'bangumi+123+456': reminder,
    });
    const db = new DbManager(storage as unknown as IStorage);
    const key = buildContentIdentityKey('bangumi', '123+456');

    await expect(db.getReminder('alice', 'bangumi', '123+456')).resolves.toBe(
      reminder,
    );
    expect(storage.setReminder).toHaveBeenCalledWith('alice', key, reminder);
    expect(storage.deleteReminder).toHaveBeenCalledWith(
      'alice',
      'bangumi+123+456',
    );
  });

  it('deletes a special-character identity by its canonical key', async () => {
    const storage = createStorage();
    storage.getAllFavorites.mockResolvedValue({});
    storage.getAllReminders.mockResolvedValue({});
    const db = new DbManager(storage as unknown as IStorage);
    const key = buildContentIdentityKey('a+b', '123+456');

    await db.deleteFavorite('alice', 'a+b', '123+456');
    await db.deleteReminder('alice', 'a+b', '123+456');

    expect(storage.deleteFavorite).toHaveBeenCalledWith('alice', key);
    expect(storage.deleteReminder).toHaveBeenCalledWith('alice', key);
  });
});

function createStorage() {
  return {
    getFavorite: jest.fn(),
    setFavorite: jest.fn(),
    getAllFavorites: jest.fn().mockResolvedValue({}),
    deleteFavorite: jest.fn(),
    getReminder: jest.fn(),
    setReminder: jest.fn(),
    getAllReminders: jest.fn().mockResolvedValue({}),
    deleteReminder: jest.fn(),
  };
}
