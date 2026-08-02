import type { UserWatchingUpdateConfig } from './admin.types';
import { clearConfigCache } from './config';
import { db } from './db';
import { triggerTokenService } from './trigger-token-service';
import {
  userWatchingUpdateConfigRepository,
  type UserWatchingUpdateConfigRepositoryContract,
} from './user-watching-update-config-repository';

export type TriggerLinkViolationReason =
  | 'ip_blocked'
  | 'ip_rate_limited'
  | 'user_rate_limited';

export interface TriggerLinkAccessLimitConfig {
  enabled: boolean;
  ipLimit: {
    enabled: boolean;
    windowMinutes: number;
    maxAttempts: number;
    blockMinutes: number;
  };
  userLimit: {
    enabled: boolean;
    windowMinutes: number;
    maxAttempts: number;
  };
  autoDisable: {
    enabled: boolean;
    violationThreshold: number;
    violationWindowMinutes: number;
  };
}

export interface TriggerLinkAccessRequest {
  tokenId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface TriggerLinkAccessDecision {
  allowed: boolean;
  error?: TriggerLinkViolationReason;
  status?: number;
  autoDisabled?: boolean;
}

export interface TriggerLinkAccessAuditRecord {
  id: string;
  tokenId: string;
  userId: string;
  ip: string;
  userAgent?: string;
  time: number;
  reason: TriggerLinkViolationReason;
}

interface CounterState {
  count: number;
  windowStartedAt: number;
}

interface BlockState {
  blockedUntil: number;
  reason: TriggerLinkViolationReason;
}

export interface TriggerLinkAccessControlStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown, expireSeconds?: number): Promise<void>;
  deleteCache(key: string): Promise<void>;
}

export interface TriggerLinkAccessControlTokenWriter {
  setEnabled(
    username: string,
    enabled: boolean,
    options?: {
      disabledReason?: string;
      disabledAt?: number;
      disabledSource?: 'admin' | 'system' | 'user';
    },
  ): Promise<unknown>;
}

const KEY_PREFIX = 'watching-update:trigger-link-access:v1';
const AUDIT_KEY = `${KEY_PREFIX}:audit`;
const AUDIT_RETENTION = 200;

export const DEFAULT_TRIGGER_LINK_ACCESS_CONTROL: TriggerLinkAccessLimitConfig =
  {
    enabled: true,
    ipLimit: {
      enabled: true,
      windowMinutes: 60,
      maxAttempts: 5,
      blockMinutes: 30,
    },
    userLimit: {
      enabled: true,
      windowMinutes: 24 * 60,
      maxAttempts: 20,
    },
    autoDisable: {
      enabled: true,
      violationThreshold: 3,
      violationWindowMinutes: 60,
    },
  };

const writeQueues = new Map<string, Promise<void>>();

function encoded(value: string) {
  return encodeURIComponent(value);
}

function ipCounterKey(ip: string) {
  return `${KEY_PREFIX}:ip-counter:${encoded(ip)}`;
}

function ipBlockKey(ip: string) {
  return `${KEY_PREFIX}:ip-block:${encoded(ip)}`;
}

function userCounterKey(userId: string) {
  return `${KEY_PREFIX}:user-counter:${encoded(userId)}`;
}

function violationKey(userId: string) {
  return `${KEY_PREFIX}:violations:${encoded(userId)}`;
}

function isCounterState(value: unknown): value is CounterState {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as CounterState).count === 'number' &&
    typeof (value as CounterState).windowStartedAt === 'number'
  );
}

function isBlockState(value: unknown): value is BlockState {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as BlockState).blockedUntil === 'number'
  );
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeAccessControlConfig(
  value?: UserWatchingUpdateConfig['triggerLinkAccessControl'],
): TriggerLinkAccessLimitConfig {
  return {
    enabled: value?.enabled !== false,
    ipLimit: {
      enabled: value?.ipLimit?.enabled !== false,
      windowMinutes: normalizePositiveInteger(
        value?.ipLimit?.windowMinutes,
        DEFAULT_TRIGGER_LINK_ACCESS_CONTROL.ipLimit.windowMinutes,
        1,
        7 * 24 * 60,
      ),
      maxAttempts: normalizePositiveInteger(
        value?.ipLimit?.maxAttempts,
        DEFAULT_TRIGGER_LINK_ACCESS_CONTROL.ipLimit.maxAttempts,
        1,
        100000,
      ),
      blockMinutes: normalizePositiveInteger(
        value?.ipLimit?.blockMinutes,
        DEFAULT_TRIGGER_LINK_ACCESS_CONTROL.ipLimit.blockMinutes,
        1,
        7 * 24 * 60,
      ),
    },
    userLimit: {
      enabled: value?.userLimit?.enabled !== false,
      windowMinutes: normalizePositiveInteger(
        value?.userLimit?.windowMinutes,
        DEFAULT_TRIGGER_LINK_ACCESS_CONTROL.userLimit.windowMinutes,
        1,
        30 * 24 * 60,
      ),
      maxAttempts: normalizePositiveInteger(
        value?.userLimit?.maxAttempts,
        DEFAULT_TRIGGER_LINK_ACCESS_CONTROL.userLimit.maxAttempts,
        1,
        100000,
      ),
    },
    autoDisable: {
      enabled: value?.autoDisable?.enabled !== false,
      violationThreshold: normalizePositiveInteger(
        value?.autoDisable?.violationThreshold,
        DEFAULT_TRIGGER_LINK_ACCESS_CONTROL.autoDisable.violationThreshold,
        1,
        100000,
      ),
      violationWindowMinutes: normalizePositiveInteger(
        value?.autoDisable?.violationWindowMinutes,
        DEFAULT_TRIGGER_LINK_ACCESS_CONTROL.autoDisable.violationWindowMinutes,
        1,
        30 * 24 * 60,
      ),
    },
  };
}

function seconds(minutes: number) {
  return minutes * 60;
}

function millis(minutes: number) {
  return minutes * 60 * 1000;
}

async function queuedWrite<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  writeQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  }
}

export class TriggerLinkAccessControlService {
  constructor(
    private readonly store: TriggerLinkAccessControlStore = db,
    private readonly configRepository: UserWatchingUpdateConfigRepositoryContract = userWatchingUpdateConfigRepository,
    private readonly tokens: TriggerLinkAccessControlTokenWriter = triggerTokenService,
    private readonly now: () => number = Date.now,
  ) {}

  async getConfig(userId: string): Promise<TriggerLinkAccessLimitConfig> {
    const userConfig =
      await this.configRepository.getUserWatchingUpdateConfig(userId);
    return normalizeAccessControlConfig(userConfig?.triggerLinkAccessControl);
  }

  async authorize(
    request: TriggerLinkAccessRequest,
  ): Promise<TriggerLinkAccessDecision> {
    const config = await this.getConfig(request.userId);
    if (!config.enabled) return { allowed: true };

    const ip = request.ip?.trim() || 'unknown';
    if (config.ipLimit.enabled) {
      const blocked = await this.readBlock(ip);
      if (blocked && blocked.blockedUntil > this.now()) {
        return this.deny(request, ip, 'ip_blocked', config);
      }
      if (blocked) await this.store.deleteCache(ipBlockKey(ip));

      const ipCount = await this.incrementCounter(
        ipCounterKey(ip),
        config.ipLimit.windowMinutes,
      );
      if (ipCount > config.ipLimit.maxAttempts) {
        await this.store.setCache(
          ipBlockKey(ip),
          {
            blockedUntil: this.now() + millis(config.ipLimit.blockMinutes),
            reason: 'ip_rate_limited',
          } satisfies BlockState,
          seconds(config.ipLimit.blockMinutes),
        );
        return this.deny(request, ip, 'ip_rate_limited', config);
      }
    }

    if (config.userLimit.enabled) {
      const userCount = await this.incrementCounter(
        userCounterKey(request.userId),
        config.userLimit.windowMinutes,
      );
      if (userCount > config.userLimit.maxAttempts) {
        return this.deny(request, ip, 'user_rate_limited', config);
      }
    }

    return { allowed: true };
  }

  async clearUserState(userId: string): Promise<void> {
    await Promise.all([
      this.store.deleteCache(userCounterKey(userId)),
      this.store.deleteCache(violationKey(userId)),
    ]);
  }

  private async incrementCounter(
    key: string,
    windowMinutes: number,
  ): Promise<number> {
    return queuedWrite(key, async () => {
      const now = this.now();
      const current = await this.store.getCache(key);
      const windowMs = millis(windowMinutes);
      const next =
        isCounterState(current) && current.windowStartedAt + windowMs > now
          ? {
              count: current.count + 1,
              windowStartedAt: current.windowStartedAt,
            }
          : { count: 1, windowStartedAt: now };
      await this.store.setCache(key, next, seconds(windowMinutes));
      return next.count;
    });
  }

  private async readBlock(ip: string): Promise<BlockState | null> {
    const value = await this.store.getCache(ipBlockKey(ip));
    return isBlockState(value) ? value : null;
  }

  private async deny(
    request: TriggerLinkAccessRequest,
    ip: string,
    reason: TriggerLinkViolationReason,
    config: TriggerLinkAccessLimitConfig,
  ): Promise<TriggerLinkAccessDecision> {
    await this.appendAudit({
      id: `${this.now()}-${Math.random().toString(36).slice(2, 10)}`,
      tokenId: request.tokenId,
      userId: request.userId,
      ip,
      userAgent: request.userAgent,
      time: this.now(),
      reason,
    });
    const autoDisabled = await this.recordViolation(request.userId, config);
    return { allowed: false, error: reason, status: 429, autoDisabled };
  }

  private async recordViolation(
    userId: string,
    config: TriggerLinkAccessLimitConfig,
  ): Promise<boolean> {
    if (!config.autoDisable.enabled) return false;
    const count = await this.incrementCounter(
      violationKey(userId),
      config.autoDisable.violationWindowMinutes,
    );
    if (count < config.autoDisable.violationThreshold) return false;

    const disabledAt = this.now();
    await this.tokens.setEnabled(userId, false, {
      disabledReason: 'rate_limit_exceeded',
      disabledAt,
      disabledSource: 'system',
    });
    clearConfigCache();
    return true;
  }

  private async appendAudit(record: TriggerLinkAccessAuditRecord) {
    await queuedWrite(AUDIT_KEY, async () => {
      const existing = await this.store.getCache(AUDIT_KEY);
      const records = Array.isArray(existing)
        ? existing.filter(
            (item): item is TriggerLinkAccessAuditRecord =>
              !!item &&
              typeof item === 'object' &&
              typeof (item as TriggerLinkAccessAuditRecord).tokenId ===
                'string' &&
              typeof (item as TriggerLinkAccessAuditRecord).userId === 'string',
          )
        : [];
      await this.store.setCache(
        AUDIT_KEY,
        [record, ...records].slice(0, AUDIT_RETENTION),
      );
    });
  }
}

export const triggerLinkAccessControlService =
  new TriggerLinkAccessControlService();
