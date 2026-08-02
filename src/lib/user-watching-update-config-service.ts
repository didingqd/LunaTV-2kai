import type { UserWatchingUpdateConfig } from './admin.types';
import {
  normalizeCronExpression,
  validateCronExpression,
} from './scheduler/cron-utils';
import {
  normalizeTimezone,
  validateTimezone,
} from './scheduler/timezone-utils';
import {
  MAX_WATCHING_UPDATE_CHECK_LOG_LIMIT,
  MIN_WATCHING_UPDATE_CHECK_LOG_LIMIT,
} from './watching-update-check-log-types';
import {
  userWatchingUpdateConfigRepository,
  type UserWatchingUpdateConfigRepositoryContract,
} from './user-watching-update-config-repository';

export type UserWatchingUpdateConfigField =
  | 'cronExpression'
  | 'timezone'
  | 'logRetentionCount'
  | 'triggerLinkAccessControl';

export type UserWatchingUpdateConfigPatch = Partial<
  Pick<UserWatchingUpdateConfig, UserWatchingUpdateConfigField>
>;

const UPDATE_FIELDS = new Set<UserWatchingUpdateConfigField>([
  'cronExpression',
  'timezone',
  'logRetentionCount',
  'triggerLinkAccessControl',
]);

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validatePatch(
  patch: UserWatchingUpdateConfigPatch,
): UserWatchingUpdateConfigPatch {
  for (const field of Object.keys(patch)) {
    if (!UPDATE_FIELDS.has(field as UserWatchingUpdateConfigField)) {
      throw new Error('UNSUPPORTED_USER_WATCHING_UPDATE_CONFIG_FIELD');
    }
  }

  const normalized: UserWatchingUpdateConfigPatch = {};
  if (hasOwn(patch, 'cronExpression')) {
    if (
      typeof patch.cronExpression !== 'string' ||
      !validateCronExpression(patch.cronExpression)
    ) {
      throw new Error('INVALID_CRON_EXPRESSION');
    }
    normalized.cronExpression = normalizeCronExpression(patch.cronExpression);
  }

  if (hasOwn(patch, 'timezone')) {
    if (
      typeof patch.timezone !== 'string' ||
      !validateTimezone(patch.timezone)
    ) {
      throw new Error('INVALID_TIMEZONE');
    }
    normalized.timezone = normalizeTimezone(patch.timezone);
  }

  if (hasOwn(patch, 'logRetentionCount')) {
    if (
      typeof patch.logRetentionCount !== 'number' ||
      !Number.isInteger(patch.logRetentionCount) ||
      patch.logRetentionCount < MIN_WATCHING_UPDATE_CHECK_LOG_LIMIT ||
      patch.logRetentionCount > MAX_WATCHING_UPDATE_CHECK_LOG_LIMIT
    ) {
      throw new Error('INVALID_LOG_RETENTION_COUNT');
    }
    normalized.logRetentionCount = patch.logRetentionCount;
  }

  if (hasOwn(patch, 'triggerLinkAccessControl')) {
    const value = patch.triggerLinkAccessControl;
    if (!value || typeof value !== 'object') {
      throw new Error('INVALID_TRIGGER_LINK_ACCESS_CONTROL');
    }
    normalized.triggerLinkAccessControl = {
      enabled: value.enabled !== false,
      ipLimit: {
        enabled: value.ipLimit?.enabled !== false,
        windowMinutes: normalizePositiveInteger(
          value.ipLimit?.windowMinutes,
          60,
          1,
          7 * 24 * 60,
        ),
        maxAttempts: normalizePositiveInteger(
          value.ipLimit?.maxAttempts,
          5,
          1,
          100000,
        ),
        blockMinutes: normalizePositiveInteger(
          value.ipLimit?.blockMinutes,
          30,
          1,
          7 * 24 * 60,
        ),
      },
      userLimit: {
        enabled: value.userLimit?.enabled !== false,
        windowMinutes: normalizePositiveInteger(
          value.userLimit?.windowMinutes,
          24 * 60,
          1,
          30 * 24 * 60,
        ),
        maxAttempts: normalizePositiveInteger(
          value.userLimit?.maxAttempts,
          20,
          1,
          100000,
        ),
      },
      autoDisable: {
        enabled: value.autoDisable?.enabled !== false,
        violationThreshold: normalizePositiveInteger(
          value.autoDisable?.violationThreshold,
          3,
          1,
          100000,
        ),
        violationWindowMinutes: normalizePositiveInteger(
          value.autoDisable?.violationWindowMinutes,
          60,
          1,
          30 * 24 * 60,
        ),
      },
    };
  }

  return normalized;
}

function hasUserOverride(config: UserWatchingUpdateConfig): boolean {
  return (
    config.cronExpression !== undefined ||
    config.timezone !== undefined ||
    config.logRetentionCount !== undefined ||
    config.triggerLink !== undefined ||
    config.triggerLinkAccessControl !== undefined
  );
}

export class UserWatchingUpdateConfigService {
  constructor(
    private readonly repository: UserWatchingUpdateConfigRepositoryContract = userWatchingUpdateConfigRepository,
  ) {}

  getUserWatchingUpdateConfig(
    username: string,
  ): Promise<UserWatchingUpdateConfig | null> {
    return this.repository.getUserWatchingUpdateConfig(username);
  }

  async updateUserWatchingUpdateConfig(
    username: string,
    patch: UserWatchingUpdateConfigPatch,
  ): Promise<UserWatchingUpdateConfig> {
    const normalized = validatePatch(patch);
    const current =
      (await this.repository.getUserWatchingUpdateConfig(username)) ?? {};
    const updated = { ...current, ...normalized };
    await this.repository.updateUserWatchingUpdateConfig(username, updated);
    return updated;
  }

  async clearUserWatchingUpdateConfigField(
    username: string,
    field: UserWatchingUpdateConfigField,
  ): Promise<UserWatchingUpdateConfig | null> {
    if (!UPDATE_FIELDS.has(field)) {
      throw new Error('UNSUPPORTED_USER_WATCHING_UPDATE_CONFIG_FIELD');
    }

    const current = await this.repository.getUserWatchingUpdateConfig(username);
    if (!current) {
      await this.repository.clearUserWatchingUpdateConfig(username);
      return null;
    }

    const updated = { ...current };
    delete updated[field];
    if (!hasUserOverride(updated)) {
      await this.repository.clearUserWatchingUpdateConfig(username);
      return null;
    }

    await this.repository.updateUserWatchingUpdateConfig(username, updated);
    return updated;
  }

  clearUserWatchingUpdateConfig(username: string): Promise<void> {
    return this.repository.clearUserWatchingUpdateConfig(username);
  }
}

export const userWatchingUpdateConfigService =
  new UserWatchingUpdateConfigService();
