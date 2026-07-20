import { DbManager } from './db';
import { playRecordStorageKey } from './play-record';
import type { IStorage, PlayRecord } from './types';

jest.mock('./kvrocks.db', () => ({ KvrocksStorage: jest.fn() }));
jest.mock('./redis.db', () => ({ RedisStorage: jest.fn() }));
jest.mock('./sqlite.db', () => ({ SqliteStorage: jest.fn() }));
jest.mock('./upstash.db', () => ({ UpstashRedisStorage: jest.fn() }));

const record: PlayRecord = {
  title: 'Demo',
  source_name: 'Source',
  cover: '',
  year: '2026',
  index: 1,
  total_episodes: 12,
  play_time: 10,
  total_time: 100,
  save_time: 1,
  search_title: 'Demo',
};

describe('DbManager PlayRecord identity storage', () => {
  it('creates and updates only the canonical entry', async () => {
    const storage = createStorage();
    const db = new DbManager(storage as unknown as IStorage);
    const key = playRecordStorageKey('a+b', '123+456');

    await db.savePlayRecord('alice', 'a+b', '123+456', record);
    await db.savePlayRecord('alice', 'a+b', '123+456', {
      ...record,
      play_time: 20,
    });

    expect(storage.setPlayRecord).toHaveBeenNthCalledWith(
      1,
      'alice',
      key,
      record,
    );
    expect(storage.setPlayRecord).toHaveBeenNthCalledWith(2, 'alice', key, {
      ...record,
      play_time: 20,
    });
    expect(storage.deletePlayRecord).not.toHaveBeenCalled();
  });

  it('lazily copies a safe legacy record and keeps the legacy entry', async () => {
    const storage = createStorage();
    storage.getPlayRecord
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record);
    const db = new DbManager(storage as unknown as IStorage);
    const canonicalKey = playRecordStorageKey('abc', '123');

    await expect(db.getPlayRecord('alice', 'abc', '123')).resolves.toBe(record);

    expect(storage.getPlayRecord).toHaveBeenNthCalledWith(
      1,
      'alice',
      canonicalKey,
    );
    expect(storage.getPlayRecord).toHaveBeenNthCalledWith(
      2,
      'alice',
      'abc+123',
    );
    expect(storage.setPlayRecord).toHaveBeenCalledWith(
      'alice',
      canonicalKey,
      record,
    );
    expect(storage.deletePlayRecord).not.toHaveBeenCalled();
  });

  it('does not fall back to an ambiguous generated legacy key', async () => {
    const storage = createStorage();
    storage.getPlayRecord.mockResolvedValue(null);
    const db = new DbManager(storage as unknown as IStorage);

    await expect(db.getPlayRecord('alice', 'a+b', '123')).resolves.toBeNull();

    expect(storage.getPlayRecord).toHaveBeenCalledTimes(1);
    expect(storage.getPlayRecord).toHaveBeenCalledWith(
      'alice',
      playRecordStorageKey('a+b', '123'),
    );
  });

  it('keeps canonical data when canonical and legacy entries coexist', async () => {
    const storage = createStorage();
    const canonicalKey = playRecordStorageKey('abc', '123');
    const canonical = { ...record, title: 'Canonical' };
    storage.getAllPlayRecords.mockResolvedValue({
      'abc+123': { ...record, title: 'Legacy' },
      [canonicalKey]: canonical,
      'a+b+123': { ...record, title: 'Ambiguous' },
    });
    const db = new DbManager(storage as unknown as IStorage);

    await expect(db.getAllPlayRecords('alice')).resolves.toEqual({
      [canonicalKey]: canonical,
    });
    expect(storage.setPlayRecord).not.toHaveBeenCalled();
    expect(storage.deletePlayRecord).not.toHaveBeenCalled();
  });

  it('deletes only canonical for identities containing a plus', async () => {
    const storage = createStorage();
    const db = new DbManager(storage as unknown as IStorage);

    await db.deletePlayRecord('alice', 'a+b', '123');

    expect(storage.deletePlayRecord).toHaveBeenCalledTimes(1);
    expect(storage.deletePlayRecord).toHaveBeenCalledWith(
      'alice',
      playRecordStorageKey('a+b', '123'),
    );
  });

  it('deletes a safe legacy key only after identity confirmation', async () => {
    const storage = createStorage();
    const db = new DbManager(storage as unknown as IStorage);

    await db.deletePlayRecord('alice', 'abc', '123');

    expect(storage.deletePlayRecord).toHaveBeenCalledWith(
      'alice',
      playRecordStorageKey('abc', '123'),
    );
    expect(storage.deletePlayRecord).toHaveBeenCalledWith('alice', 'abc+123');
  });
});

function createStorage() {
  return {
    getPlayRecord: jest.fn(),
    setPlayRecord: jest.fn(),
    getAllPlayRecords: jest.fn().mockResolvedValue({}),
    deletePlayRecord: jest.fn(),
  };
}
