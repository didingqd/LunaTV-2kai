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

function parsePlainToken(token: string): { tokenId: string; secret: string } {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('TRIGGER_TOKEN_INVALID');
  }
  return { tokenId: parts[0], secret: parts[1] };
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
    const { tokenId, secret } = parsePlainToken(token);
    const record = await this.tokenRepository.getToken(tokenId);
    if (!record) throw new Error('TRIGGER_TOKEN_INVALID');
    if (!record.enabled) throw new Error('TRIGGER_TOKEN_DISABLED');
    const now = this.clock.now();
    if (typeof record.expiresAt === 'number' && record.expiresAt <= now) {
      throw new Error('TRIGGER_TOKEN_EXPIRED');
    }

    const expectedHash = hashTriggerTokenSecret(secret);
    if (!safeHashEquals(record.secretHash, expectedHash)) {
      throw new Error('TRIGGER_TOKEN_INVALID');
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

  async rotateToken(username: string): Promise<TriggerLinkTokenResult> {
    const { record, userConfig } = await this.getCurrentRecord(username);
    const now = this.clock.now();
    const secret = createSecret();
    const updated = await this.tokenRepository.updateToken(record.tokenId, {
      secretHash: hashTriggerTokenSecret(secret),
      enabled: true,
      rotatedAt: now,
    });
    await this.saveMetadata(username, userConfig, updated);
    return {
      ...statusFromRecord(updated, recordToMetadata(updated), now),
      plainToken: toPlainToken(updated.tokenId, secret),
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
