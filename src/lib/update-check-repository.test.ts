/** @jest-environment node */

import {
  CachedUpdateCheckTaskRepository,
  updateCheckTaskId,
} from './update-check-repository';
import type { UpdateCheckTask } from './update-check-types';

class MemoryCache {
  values = new Map<string, unknown>();

  async getCache(key: string) {
    return this.values.get(key) ?? null;
  }

  async setCache(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async deleteCache(key: string) {
    this.values.delete(key);
  }
}

function task(
  userId: string,
  followId: string,
  nextCheckAt: number,
): UpdateCheckTask {
  const id = updateCheckTaskId(userId, followId);
  return {
    id,
    userId,
    followId,
    source: 'source-a',
    resourceId: followId,
    nextCheckAt,
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('CachedUpdateCheckTaskRepository', () => {
  it('reads only the due prefix in nextCheckAt order', async () => {
    const repository = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const late = task('alice', 'late', 300);
    const early = task('alice', 'early', 100);
    await repository.save(late);
    await repository.save(early);

    const due = await repository.listDue(150, 10);

    expect(due.map((item) => item.followId)).toEqual(['early']);
  });

  it('deletes a user task without affecting another user', async () => {
    const repository = new CachedUpdateCheckTaskRepository(new MemoryCache());
    const alice = task('alice', 'follow-a', 100);
    const bob = task('bob', 'follow-b', 100);
    await repository.save(alice);
    await repository.save(bob);

    await repository.deleteForUser('alice');

    expect(await repository.get(alice.id)).toBeNull();
    expect(await repository.get(bob.id)).toEqual(bob);
    expect(
      (await repository.listDue(100, 10)).map((item) => item.userId),
    ).toEqual(['bob']);
  });
});
