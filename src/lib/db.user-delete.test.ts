import { DbManager } from './db';
import type { IStorage } from './types';

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
});

function createStorage(cache: Map<string, unknown>) {
  return {
    deleteUser: jest.fn(),
    deleteCache: jest.fn(async (key: string) => {
      cache.delete(key);
    }),
  };
}
