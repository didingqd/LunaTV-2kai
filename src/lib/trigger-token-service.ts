import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import type { UserWatchingUpdateConfig } from './admin.types';
import {
  triggerTokenRepository,
  type TriggerTokenRecord,
  type TriggerTokenRepositoryContract,
} from './trigger-token-repository';
import {
  userWatchingUpdateConfigRepository,
  type UserWatchingUpdateConfigRepositoryContract,
} from './user-watching-update-config-repository';

export interface TriggerLinkStatus {
  enabled: boolean;
  createdAt: number | null;
  rotatedAt: number | null;
  expiresAt: number | null;
  hasToken: boolean;
  expired: boolean;
  tokenId: string | null;
  maskedToken: string | null;
  canRevealToken: boolean;
}

export interface TriggerLinkTokenResult extends TriggerLinkStatus {
  plainToken: string;
}

export interface TriggerTokenVerifyResult {
  tokenId: string;
  userId: string;
  lastUsedAt: number;
}

export interface TriggerTokenServiceClock {
  now(): number;
}

const TOKEN_ID_BYTES = 16;
const TOKEN_SECRET_BYTES = 32;
const MAX_TOKEN_ID_ATTEMPTS = 5;

function createSecret() {
  return randomBytes(TOKEN_SECRET_BYTES).toString('base64url');
}

function createTokenId() {
  return randomBytes(TOKEN_ID_BYTES).toString('base64url');
}

export function hashTriggerTokenSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function toPlainToken(tokenId: string, secret: string) {
  return `${tokenId}.${secret}`;
}

function parseDottedPlainToken(
  token: string,
): { tokenId: string; secret: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { tokenId: parts[0], secret: parts[1] };
}

export function maskTriggerToken(token: string): string {
  if (token.length <= 8) return `${token.slice(0, 2)}****${token.slice(-2)}`;
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}

function safeHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function hasUserConfigOverride(config: UserWatchingUpdateConfig): boolean {
  return (
    config.cronExpression !== undefined ||
    config.timezone !== undefined ||
    config.logRetentionCount !== undefined ||
    config.triggerLink !== undefined
  );
}

function statusFromRecord(
  record: TriggerTokenRecord | null,
  metadata: UserWatchingUpdateConfig['triggerLink'] | undefined,
  now: number,
): TriggerLinkStatus {
  const expiresAt = record?.expiresAt ?? metadata?.expiresAt ?? null;
  const hasToken = Boolean(record);
  return {
    enabled: hasToken ? record!.enabled : false,
    createdAt: record?.createdAt ?? metadata?.createdAt ?? null,
    rotatedAt: record?.rotatedAt ?? metadata?.rotatedAt ?? null,
    expiresAt,
    hasToken,
    expired: typeof expiresAt === 'number' && expiresAt <= now,
    tokenId: record?.tokenId ?? metadata?.tokenId ?? null,
    maskedToken: record?.plainToken ? maskTriggerToken(record.plainToken) : null,
    canRevealToken: Boolean(record?.plainToken),
  };
}

export class TriggerTokenService {
  constructor(
    private readonly tokenRepository: TriggerTokenRepositoryContract = triggerTokenRepository,
    private readonly configRepository: UserWatchingUpdateConfigRepositoryContract = userWatchingUpdateConfigRepository,
    private readonly clock: TriggerTokenServiceClock = { now: () => Date.now() },
  ) {}

  async getStatus(username: string): Promise<TriggerLinkStatus> {
    const userConfig = await this.configRepository.getUserWatchingUpdateConfig(
      username,
    );
    const tokenId =
      userConfig?.triggerLink?.tokenId ??
      (await this.tokenRepository.getTokenIdForUser(username));
    const record = tokenId ? await this.tokenRepository.getToken(tokenId) : null;
    return statusFromRecord(record, userConfig?.triggerLink, this.clock.now());
  }

  async verify(token: string): Promise<TriggerTokenVerifyResult> {
    const parsed = parseDottedPlainToken(token);
    let record: TriggerTokenRecord | null = null;
    if (parsed) {
      record = await this.tokenRepository.getToken(parsed.tokenId);
    }
    if (!record) {
      const lookupHash = hashTriggerTokenSecret(token);
      const tokenId =
        await this.tokenRepository.getTokenIdForLookupHash(lookupHash);
      record = tokenId ? await this.tokenRepository.getToken(tokenId) : null;
    }
    if (!record) throw new Error('TRIGGER_TOKEN_INVALID');
    if (!record.enabled) throw new Error('TRIGGER_TOKEN_DISABLED');
    const now = this.clock.now();
    if (typeof record.expiresAt === 'number' && record.expiresAt <= now) {
      throw new Error('TRIGGER_TOKEN_EXPIRED');
    }

    if (parsed && record.tokenId === parsed.tokenId) {
      const expectedHash = hashTriggerTokenSecret(parsed.secret);
      if (!safeHashEquals(record.secretHash, expectedHash)) {
        throw new Error('TRIGGER_TOKEN_INVALID');
      }
    } else {
      const expectedLookupHash = hashTriggerTokenSecret(token);
      if (
        !record.lookupHash ||
        !safeHashEquals(record.lookupHash, expectedLookupHash)
      ) {
        throw new Error('TRIGGER_TOKEN_INVALID');
      }
    }

    await this.tokenRepository.updateToken(record.tokenId, {
      lastUsedAt: now,
    });
    return { tokenId: record.tokenId, userId: record.userId, lastUsedAt: now };
  }

  async createToken(
    username: string,
    options: { expiresAt?: number | null } = {},
  ): Promise<TriggerLinkTokenResult> {
    const now = this.clock.now();
    const secret = createSecret();
    const tokenId = await this.createUniqueTokenId();
    const record: TriggerTokenRecord = {
      tokenId,
      userId: username,
      secretHash: hashTriggerTokenSecret(secret),
      lookupHash: hashTriggerTokenSecret(toPlainToken(tokenId, secret)),
      plainToken: toPlainToken(tokenId, secret),
      enabled: true,
      createdAt: now,
      rotatedAt: now,
      expiresAt: options.expiresAt ?? null,
      lastUsedAt: null,
    };

    const current = await this.configRepository.getUserWatchingUpdateConfig(
      username,
    );
    const currentTokenId = current?.triggerLink?.tokenId;
    if (currentTokenId && currentTokenId !== tokenId) {
      await this.tokenRepository.deleteToken(currentTokenId);
    }

    await this.tokenRepository.createToken(record);
    await this.saveMetadata(username, current, record);

    return {
      ...statusFromRecord(record, recordToMetadata(record), now),
      plainToken: toPlainToken(tokenId, secret),
    };
  }

  async setToken(
    username: string,
    token: string,
    options: { enabled?: boolean; expiresAt?: number | null } = {},
  ): Promise<TriggerLinkTokenResult> {
    const trimmed = token.trim();
    if (!trimmed) throw new Error('TRIGGER_TOKEN_INVALID');

    const now = this.clock.now();
    const parsed = parseDottedPlainToken(trimmed);
    const tokenId = parsed ? parsed.tokenId : await this.createUniqueTokenId();
    const secret = parsed ? parsed.secret : trimmed;
    const record: TriggerTokenRecord = {
      tokenId,
      userId: username,
      secretHash: hashTriggerTokenSecret(secret),
      lookupHash: hashTriggerTokenSecret(trimmed),
      plainToken: trimmed,
      enabled: options.enabled ?? true,
      createdAt: now,
      rotatedAt: now,
      expiresAt: options.expiresAt ?? null,
      lastUsedAt: null,
    };

    const current = await this.configRepository.getUserWatchingUpdateConfig(
      username,
    );
    const currentTokenId = current?.triggerLink?.tokenId;
    if (currentTokenId && currentTokenId !== tokenId) {
      await this.tokenRepository.deleteToken(currentTokenId);
    }

    await this.tokenRepository.createToken(record);
    await this.saveMetadata(username, current, record);

    return {
      ...statusFromRecord(record, recordToMetadata(record), now),
      plainToken: trimmed,
    };
  }

  async rotateToken(username: string): Promise<TriggerLinkTokenResult> {
    const { record, userConfig } = await this.getCurrentRecord(username);
    const now = this.clock.now();
    const secret = createSecret();
    const plainToken = toPlainToken(record.tokenId, secret);
    const updated = await this.tokenRepository.updateToken(record.tokenId, {
      secretHash: hashTriggerTokenSecret(secret),
      lookupHash: hashTriggerTokenSecret(plainToken),
      plainToken,
      enabled: true,
      rotatedAt: now,
    });
    await this.saveMetadata(username, userConfig, updated);
    return {
      ...statusFromRecord(updated, recordToMetadata(updated), now),
      plainToken,
    };
  }

  async revealToken(username: string): Promise<TriggerLinkTokenResult> {
    const { record } = await this.getCurrentRecord(username);
    if (!record.plainToken) throw new Error('TRIGGER_TOKEN_SECRET_UNAVAILABLE');
    return {
      ...statusFromRecord(record, recordToMetadata(record), this.clock.now()),
      plainToken: record.plainToken,
    };
  }

  async setEnabled(
    username: string,
    enabled: boolean,
  ): Promise<TriggerLinkStatus> {
    const { record, userConfig } = await this.getCurrentRecord(username);
    const updated = await this.tokenRepository.updateToken(record.tokenId, {
      enabled,
    });
    await this.saveMetadata(username, userConfig, updated);
    return statusFromRecord(updated, recordToMetadata(updated), this.clock.now());
  }

  async setExpiresAt(
    username: string,
    expiresAt: number | null,
  ): Promise<TriggerLinkStatus> {
    const { record, userConfig } = await this.getCurrentRecord(username);
    const updated = await this.tokenRepository.updateToken(record.tokenId, {
      expiresAt,
    });
    await this.saveMetadata(username, userConfig, updated);
    return statusFromRecord(updated, recordToMetadata(updated), this.clock.now());
  }

  async expireToken(username: string): Promise<TriggerLinkStatus> {
    return this.setExpiresAt(username, this.clock.now());
  }

  async deleteToken(username: string): Promise<TriggerLinkStatus> {
    const userConfig = await this.configRepository.getUserWatchingUpdateConfig(
      username,
    );
    if (userConfig?.triggerLink?.tokenId) {
      await this.tokenRepository.deleteToken(userConfig.triggerLink.tokenId);
    }
    await this.tokenRepository.deleteTokenForUser(username);
    await this.clearMetadata(username, userConfig);
    return {
      enabled: false,
      createdAt: null,
      rotatedAt: null,
      expiresAt: null,
      hasToken: false,
      expired: false,
      tokenId: null,
      maskedToken: null,
      canRevealToken: false,
    };
  }

  private async createUniqueTokenId(): Promise<string> {
    for (let attempt = 0; attempt < MAX_TOKEN_ID_ATTEMPTS; attempt += 1) {
      const tokenId = createTokenId();
      if (!(await this.tokenRepository.getToken(tokenId))) return tokenId;
    }
    throw new Error('TRIGGER_TOKEN_ID_COLLISION');
  }

  private async getCurrentRecord(username: string): Promise<{
    record: TriggerTokenRecord;
    userConfig: UserWatchingUpdateConfig | null;
  }> {
    const userConfig = await this.configRepository.getUserWatchingUpdateConfig(
      username,
    );
    const tokenId =
      userConfig?.triggerLink?.tokenId ??
      (await this.tokenRepository.getTokenIdForUser(username));
    const record = tokenId ? await this.tokenRepository.getToken(tokenId) : null;
    if (!record) throw new Error('TRIGGER_TOKEN_NOT_FOUND');
    if (record.userId !== username) throw new Error('TRIGGER_TOKEN_NOT_FOUND');
    return { record, userConfig };
  }

  private async saveMetadata(
    username: string,
    current: UserWatchingUpdateConfig | null,
    record: TriggerTokenRecord,
  ) {
    await this.configRepository.updateUserWatchingUpdateConfig(username, {
      ...(current ?? {}),
      triggerLink: recordToMetadata(record),
    });
  }

  private async clearMetadata(
    username: string,
    current: UserWatchingUpdateConfig | null,
  ) {
    if (!current?.triggerLink) return;
    const updated = { ...current };
    delete updated.triggerLink;
    if (hasUserConfigOverride(updated)) {
      await this.configRepository.updateUserWatchingUpdateConfig(
        username,
        updated,
      );
    } else {
      await this.configRepository.clearUserWatchingUpdateConfig(username);
    }
  }
}

function recordToMetadata(record: TriggerTokenRecord) {
  return {
    enabled: record.enabled,
    tokenId: record.tokenId,
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt,
    expiresAt: record.expiresAt ?? undefined,
  };
}

export const triggerTokenService = new TriggerTokenService();
