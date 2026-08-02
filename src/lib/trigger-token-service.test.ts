jest.mock('./db', () => ({
  db: {},
}));

import type { UserWatchingUpdateConfig } from './admin.types';
import {
  TriggerTokenService,
  hashTriggerTokenSecret,
} from './trigger-token-service';
import type {
  TriggerTokenRecord,
  TriggerTokenRepositoryContract,
} from './trigger-token-repository';
import type { UserWatchingUpdateConfigRepositoryContract } from './user-watching-update-config-repository';

class MemoryTokenRepository implements TriggerTokenRepositoryContract {
  readonly tokens = new Map<string, TriggerTokenRecord>();
  readonly userIndex = new Map<string, string>();

  async createToken(record: TriggerTokenRecord): Promise<void> {
    const existing = this.userIndex.get(record.userId);
    if (existing && existing !== record.tokenId) this.tokens.delete(existing);
    this.tokens.set(record.tokenId, { ...record });
    this.userIndex.set(record.userId, record.tokenId);
  }

  async getToken(tokenId: string): Promise<TriggerTokenRecord | null> {
    const record = this.tokens.get(tokenId);
    return record ? { ...record } : null;
  }

  async getTokenIdForUser(userId: string): Promise<string | null> {
    return this.userIndex.get(userId) ?? null;
  }

  async getTokenIdForLookupHash(lookupHash: string): Promise<string | null> {
    for (const [tokenId, record] of this.tokens) {
      if (record.lookupHash === lookupHash) return tokenId;
    }
    return null;
  }

  async updateToken(
    tokenId: string,
    patch: Partial<Omit<TriggerTokenRecord, 'tokenId' | 'userId' | 'createdAt'>>,
  ): Promise<TriggerTokenRecord> {
    const current = this.tokens.get(tokenId);
    if (!current) throw new Error('TRIGGER_TOKEN_NOT_FOUND');
    const updated = { ...current, ...patch };
    this.tokens.set(tokenId, updated);
    return { ...updated };
  }

  async deleteToken(tokenId: string): Promise<void> {
    const current = this.tokens.get(tokenId);
    this.tokens.delete(tokenId);
    if (current) this.userIndex.delete(current.userId);
  }

  async deleteTokenForUser(userId: string): Promise<void> {
    const tokenId = this.userIndex.get(userId);
    if (tokenId) this.tokens.delete(tokenId);
    this.userIndex.delete(userId);
  }
}

class MemoryConfigRepository implements UserWatchingUpdateConfigRepositoryContract {
  readonly configs = new Map<string, UserWatchingUpdateConfig>();

  async getUserWatchingUpdateConfig(
    username: string,
  ): Promise<UserWatchingUpdateConfig | null> {
    const config = this.configs.get(username);
    return config ? { ...config, triggerLink: config.triggerLink && { ...config.triggerLink } } : null;
  }

  async updateUserWatchingUpdateConfig(
    username: string,
    config: UserWatchingUpdateConfig,
  ): Promise<void> {
    this.configs.set(username, {
      ...config,
      triggerLink: config.triggerLink && { ...config.triggerLink },
    });
  }

  async clearUserWatchingUpdateConfig(username: string): Promise<void> {
    this.configs.delete(username);
  }
}

function createService(now = 1000) {
  const tokenRepository = new MemoryTokenRepository();
  const configRepository = new MemoryConfigRepository();
  let currentNow = now;
  const service = new TriggerTokenService(tokenRepository, configRepository, {
    now: () => currentNow,
  });
  return {
    service,
    tokenRepository,
    configRepository,
    setNow: (next: number) => {
      currentNow = next;
    },
  };
}

function splitPlainToken(plainToken: string) {
  const [tokenId, secret] = plainToken.split('.');
  return { tokenId, secret };
}

describe('TriggerTokenService', () => {
  it('creates a token, stores hashes, and saves triggerLink metadata', async () => {
    const { service, tokenRepository, configRepository } = createService();

    const result = await service.createToken('alice', { expiresAt: 5000 });
    const { tokenId, secret } = splitPlainToken(result.plainToken);
    const stored = await tokenRepository.getToken(tokenId);

    expect(result).toMatchObject({
      enabled: true,
      hasToken: true,
      expired: false,
      createdAt: 1000,
      rotatedAt: 1000,
      expiresAt: 5000,
    });
    expect(stored).toMatchObject({
      tokenId,
      userId: 'alice',
      secretHash: hashTriggerTokenSecret(secret),
      lookupHash: hashTriggerTokenSecret(result.plainToken),
      plainToken: result.plainToken,
      enabled: true,
    });
    expect(stored?.secretHash).not.toBe(secret);
    expect(JSON.stringify(configRepository.configs.get('alice'))).not.toContain(secret);
    expect(configRepository.configs.get('alice')?.triggerLink).toEqual({
      enabled: true,
      tokenId,
      createdAt: 1000,
      rotatedAt: 1000,
      expiresAt: 5000,
    });
  });

  it('returns status without a plain token', async () => {
    const { service } = createService();
    await service.createToken('alice');

    const status = await service.getStatus('alice');

    expect(status).toEqual({
      enabled: true,
      createdAt: 1000,
      rotatedAt: 1000,
      expiresAt: null,
      hasToken: true,
      expired: false,
      tokenId: expect.any(String),
      maskedToken: expect.stringContaining('****'),
      canRevealToken: true,
    });
    expect(status).not.toHaveProperty('plainToken');
  });

  it('verifies a token and updates lastUsedAt', async () => {
    const { service, tokenRepository, setNow } = createService();
    const created = await service.createToken('alice');
    const { tokenId } = splitPlainToken(created.plainToken);
    setNow(2500);

    await expect(service.verify(created.plainToken)).resolves.toEqual({
      tokenId,
      userId: 'alice',
      lastUsedAt: 2500,
    });
    await expect(tokenRepository.getToken(tokenId)).resolves.toMatchObject({
      lastUsedAt: 2500,
      createdAt: 1000,
      rotatedAt: 1000,
    });
  });

  it('rejects invalid token secrets', async () => {
    const { service } = createService();
    const created = await service.createToken('alice');
    const { tokenId } = splitPlainToken(created.plainToken);

    await expect(service.verify(`${tokenId}.wrong-secret`)).rejects.toThrow(
      'TRIGGER_TOKEN_INVALID',
    );
  });

  it('rejects disabled and expired tokens', async () => {
    const { service, setNow } = createService();
    const created = await service.createToken('alice', { expiresAt: 3000 });

    await service.setEnabled('alice', false);
    await expect(service.verify(created.plainToken)).rejects.toThrow(
      'TRIGGER_TOKEN_DISABLED',
    );

    await service.setEnabled('alice', true);
    setNow(3000);
    await expect(service.verify(created.plainToken)).rejects.toThrow(
      'TRIGGER_TOKEN_EXPIRED',
    );
  });

  it('rotates the secret and invalidates the old secret hash at data layer', async () => {
    const { service, tokenRepository, setNow } = createService();
    const initial = await service.createToken('alice');
    const { tokenId, secret: oldSecret } = splitPlainToken(initial.plainToken);
    setNow(2000);

    const rotated = await service.rotateToken('alice');
    const { tokenId: rotatedTokenId, secret: newSecret } = splitPlainToken(
      rotated.plainToken,
    );
    const stored = await tokenRepository.getToken(tokenId);

    expect(rotatedTokenId).toBe(tokenId);
    expect(newSecret).not.toBe(oldSecret);
    expect(stored?.secretHash).toBe(hashTriggerTokenSecret(newSecret));
    expect(stored?.secretHash).not.toBe(hashTriggerTokenSecret(oldSecret));
    expect(rotated.rotatedAt).toBe(2000);
  });

  it('enables and disables a token', async () => {
    const { service, tokenRepository } = createService();
    const created = await service.createToken('alice');
    const { tokenId } = splitPlainToken(created.plainToken);

    await expect(service.setEnabled('alice', false)).resolves.toMatchObject({
      enabled: false,
    });
    await expect(tokenRepository.getToken(tokenId)).resolves.toMatchObject({
      enabled: false,
    });
    await expect(service.setEnabled('alice', true)).resolves.toMatchObject({
      enabled: true,
    });
  });

  it('expires a token', async () => {
    const { service, setNow } = createService();
    await service.createToken('alice');
    setNow(3000);

    await expect(service.expireToken('alice')).resolves.toMatchObject({
      expiresAt: 3000,
      expired: true,
    });
  });

  it('deletes token storage and triggerLink metadata', async () => {
    const { service, tokenRepository, configRepository } = createService();
    const created = await service.createToken('alice');
    const { tokenId } = splitPlainToken(created.plainToken);

    await service.deleteToken('alice');

    await expect(tokenRepository.getToken(tokenId)).resolves.toBeNull();
    await expect(tokenRepository.getTokenIdForUser('alice')).resolves.toBeNull();
    expect(configRepository.configs.has('alice')).toBe(false);
  });

  it('preserves existing user overrides when deleting triggerLink metadata', async () => {
    const { service, configRepository } = createService();
    configRepository.configs.set('alice', {
      cronExpression: '0 */6 * * *',
      timezone: 'Asia/Tokyo',
      logRetentionCount: 500,
    });
    await service.createToken('alice');

    await service.deleteToken('alice');

    expect(configRepository.configs.get('alice')).toEqual({
      cronExpression: '0 */6 * * *',
      timezone: 'Asia/Tokyo',
      logRetentionCount: 500,
    });
  });

  it('reports missing token metadata as an empty status for old users', async () => {
    const { service } = createService();

    await expect(service.getStatus('alice')).resolves.toEqual({
      enabled: false,
      createdAt: null,
      rotatedAt: null,
      expiresAt: null,
      hasToken: false,
      expired: false,
      tokenId: null,
      maskedToken: null,
      canRevealToken: false,
    });
  });

  it('reveals the persisted plain token through a dedicated operation', async () => {
    const { service } = createService();
    const created = await service.createToken('alice');

    await expect(service.revealToken('alice')).resolves.toMatchObject({
      plainToken: created.plainToken,
      maskedToken: expect.stringContaining('****'),
    });
  });

  it('sets a manual token and verifies the exact custom value', async () => {
    const { service } = createService();

    await service.setToken('alice', 'custom-token');

    await expect(service.verify('custom-token')).resolves.toMatchObject({
      userId: 'alice',
    });
    await expect(service.verify('wrong-token')).rejects.toThrow(
      'TRIGGER_TOKEN_INVALID',
    );
  });
});
