jest.mock('./db', () => ({
  db: {},
}));

import {
  TriggerTokenRepository,
  type TriggerTokenRecord,
  type TriggerTokenStore,
} from './trigger-token-repository';

class MemoryTriggerTokenStore implements TriggerTokenStore {
  readonly values = new Map<string, unknown>();

  async getCache(key: string): Promise<unknown | null> {
    return this.values.get(key) ?? null;
  }

  async setCache(key: string, data: unknown): Promise<void> {
    this.values.set(key, data);
  }

  async deleteCache(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function token(overrides: Partial<TriggerTokenRecord> = {}): TriggerTokenRecord {
  return {
    tokenId: 'token-1',
    userId: 'alice',
    secretHash: 'hash-1',
    enabled: true,
    createdAt: 1000,
    rotatedAt: 1000,
    expiresAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}

describe('TriggerTokenRepository', () => {
  it('creates and reads a token by tokenId', async () => {
    const repository = new TriggerTokenRepository(new MemoryTriggerTokenStore());

    await repository.createToken(token());

    await expect(repository.getToken('token-1')).resolves.toEqual(token());
    await expect(repository.getTokenIdForUser('alice')).resolves.toBe('token-1');
  });

  it('isolates user token indexes', async () => {
    const repository = new TriggerTokenRepository(new MemoryTriggerTokenStore());

    await repository.createToken(token({ tokenId: 'token-alice', userId: 'alice' }));
    await repository.createToken(token({ tokenId: 'token-bob', userId: 'bob' }));

    await expect(repository.getTokenIdForUser('alice')).resolves.toBe('token-alice');
    await expect(repository.getTokenIdForUser('bob')).resolves.toBe('token-bob');
  });

  it('replaces an existing user token when creating a new one', async () => {
    const repository = new TriggerTokenRepository(new MemoryTriggerTokenStore());

    await repository.createToken(token({ tokenId: 'old-token' }));
    await repository.createToken(token({ tokenId: 'new-token', secretHash: 'hash-2' }));

    await expect(repository.getToken('old-token')).resolves.toBeNull();
    await expect(repository.getToken('new-token')).resolves.toMatchObject({
      secretHash: 'hash-2',
    });
    await expect(repository.getTokenIdForUser('alice')).resolves.toBe('new-token');
  });

  it('updates mutable token fields without changing identity fields', async () => {
    const repository = new TriggerTokenRepository(new MemoryTriggerTokenStore());

    await repository.createToken(token());
    const updated = await repository.updateToken('token-1', {
      enabled: false,
      secretHash: 'hash-2',
      rotatedAt: 2000,
      expiresAt: 3000,
      lastUsedAt: 2500,
    });

    expect(updated).toEqual(
      token({
        secretHash: 'hash-2',
        enabled: false,
        rotatedAt: 2000,
        expiresAt: 3000,
        lastUsedAt: 2500,
      }),
    );
    await expect(repository.getTokenIdForUser('alice')).resolves.toBe('token-1');
  });

  it('deletes a token and its user index', async () => {
    const repository = new TriggerTokenRepository(new MemoryTriggerTokenStore());

    await repository.createToken(token());
    await repository.deleteToken('token-1');

    await expect(repository.getToken('token-1')).resolves.toBeNull();
    await expect(repository.getTokenIdForUser('alice')).resolves.toBeNull();
  });

  it('deletes a token by user', async () => {
    const repository = new TriggerTokenRepository(new MemoryTriggerTokenStore());

    await repository.createToken(token());
    await repository.deleteTokenForUser('alice');

    await expect(repository.getToken('token-1')).resolves.toBeNull();
    await expect(repository.getTokenIdForUser('alice')).resolves.toBeNull();
  });
});
