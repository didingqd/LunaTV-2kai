import { db } from './db';

export interface TriggerTokenRecord {
  tokenId: string;
  userId: string;
  secretHash: string;
  lookupHash?: string;
  plainToken?: string;
  enabled: boolean;
  createdAt: number;
  rotatedAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
}

export interface TriggerTokenStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown, expireSeconds?: number): Promise<void>;
  deleteCache(key: string): Promise<void>;
}

export interface TriggerTokenRepositoryContract {
  createToken(record: TriggerTokenRecord): Promise<void>;
  getToken(tokenId: string): Promise<TriggerTokenRecord | null>;
  getTokenIdForUser(userId: string): Promise<string | null>;
  getTokenIdForLookupHash(lookupHash: string): Promise<string | null>;
  updateToken(
    tokenId: string,
    patch: Partial<Omit<TriggerTokenRecord, 'tokenId' | 'userId' | 'createdAt'>>,
  ): Promise<TriggerTokenRecord>;
  deleteToken(tokenId: string): Promise<void>;
  deleteTokenForUser(userId: string): Promise<void>;
}

const TOKEN_KEY_PREFIX = 'watching-update:trigger-token:v1:';
const USER_TOKEN_KEY_PREFIX = 'watching-update:trigger-token:v1:user:';
const LOOKUP_HASH_KEY_PREFIX = 'watching-update:trigger-token:v1:lookup:';

function tokenKey(tokenId: string) {
  return `${TOKEN_KEY_PREFIX}${tokenId}`;
}

function userTokenKey(userId: string) {
  return `${USER_TOKEN_KEY_PREFIX}${userId}`;
}

function lookupHashKey(lookupHash: string) {
  return `${LOOKUP_HASH_KEY_PREFIX}${lookupHash}`;
}

function copyRecord(record: TriggerTokenRecord): TriggerTokenRecord {
  return { ...record };
}

function isTokenRecord(value: unknown): value is TriggerTokenRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as TriggerTokenRecord;
  return (
    typeof record.tokenId === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.secretHash === 'string' &&
    (record.lookupHash === undefined || typeof record.lookupHash === 'string') &&
    (record.plainToken === undefined || typeof record.plainToken === 'string') &&
    typeof record.enabled === 'boolean' &&
    typeof record.createdAt === 'number' &&
    typeof record.rotatedAt === 'number' &&
    (typeof record.expiresAt === 'number' || record.expiresAt === null) &&
    (typeof record.lastUsedAt === 'number' || record.lastUsedAt === null)
  );
}

export class TriggerTokenRepository implements TriggerTokenRepositoryContract {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: TriggerTokenStore = db) {}

  async createToken(record: TriggerTokenRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      const existingTokenId = await this.getTokenIdForUser(record.userId);
      if (existingTokenId && existingTokenId !== record.tokenId) {
        const existing = await this.getToken(existingTokenId);
        if (existing?.lookupHash) {
          await this.store.deleteCache(lookupHashKey(existing.lookupHash));
        }
        await this.store.deleteCache(tokenKey(existingTokenId));
      }
      await this.store.setCache(tokenKey(record.tokenId), copyRecord(record));
      await this.store.setCache(userTokenKey(record.userId), record.tokenId);
      if (record.lookupHash) {
        await this.store.setCache(
          lookupHashKey(record.lookupHash),
          record.tokenId,
        );
      }
    });
  }

  async getToken(tokenId: string): Promise<TriggerTokenRecord | null> {
    const value = await this.store.getCache(tokenKey(tokenId));
    return isTokenRecord(value) ? copyRecord(value) : null;
  }

  async getTokenIdForUser(userId: string): Promise<string | null> {
    const value = await this.store.getCache(userTokenKey(userId));
    return typeof value === 'string' ? value : null;
  }

  async getTokenIdForLookupHash(lookupHash: string): Promise<string | null> {
    const value = await this.store.getCache(lookupHashKey(lookupHash));
    return typeof value === 'string' ? value : null;
  }

  async updateToken(
    tokenId: string,
    patch: Partial<Omit<TriggerTokenRecord, 'tokenId' | 'userId' | 'createdAt'>>,
  ): Promise<TriggerTokenRecord> {
    return this.enqueueWrite(async () => {
      const current = await this.getToken(tokenId);
      if (!current) throw new Error('TRIGGER_TOKEN_NOT_FOUND');
      const updated = { ...current, ...patch };
      if (current.lookupHash && current.lookupHash !== updated.lookupHash) {
        await this.store.deleteCache(lookupHashKey(current.lookupHash));
      }
      await this.store.setCache(tokenKey(tokenId), copyRecord(updated));
      await this.store.setCache(userTokenKey(updated.userId), updated.tokenId);
      if (updated.lookupHash) {
        await this.store.setCache(
          lookupHashKey(updated.lookupHash),
          updated.tokenId,
        );
      }
      return updated;
    });
  }

  async deleteToken(tokenId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const current = await this.getToken(tokenId);
      await this.store.deleteCache(tokenKey(tokenId));
      if (current?.lookupHash) {
        await this.store.deleteCache(lookupHashKey(current.lookupHash));
      }
      if (current) await this.store.deleteCache(userTokenKey(current.userId));
    });
  }

  async deleteTokenForUser(userId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const tokenId = await this.getTokenIdForUser(userId);
      const current = tokenId ? await this.getToken(tokenId) : null;
      if (tokenId) await this.store.deleteCache(tokenKey(tokenId));
      if (current?.lookupHash) {
        await this.store.deleteCache(lookupHashKey(current.lookupHash));
      }
      await this.store.deleteCache(userTokenKey(userId));
    });
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(operation);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export const triggerTokenRepository = new TriggerTokenRepository();
