import type { SystemConfig, UserWatchingUpdateConfig } from '@/lib/admin.types';
import {
  DEFAULT_UPDATE_CHECK_CRON_EXPRESSION,
  normalizeCronExpression,
  validateCronExpression,
} from '@/lib/scheduler/cron-utils';
import {
  DEFAULT_SCHEDULER_TIMEZONE,
  normalizeTimezone,
  validateTimezone,
} from '@/lib/scheduler/timezone-utils';
import {
  DEFAULT_WATCHING_UPDATE_CHECK_LOG_LIMIT,
  MAX_WATCHING_UPDATE_CHECK_LOG_LIMIT,
  MIN_WATCHING_UPDATE_CHECK_LOG_LIMIT,
  normalizeWatchingUpdateCheckLogRetentionCount,
} from '@/lib/watching-update-check-log-types';

type WatchingUpdateConfigSource = 'user' | 'system' | 'default';

export interface ResolveUserWatchingUpdateConfigInput {
  username: string;
  userUpdateCheckBackendEnabled?: boolean;
  systemConfig?: Partial<SystemConfig> | null;
  userConfig?: UserWatchingUpdateConfig | null;
}

export interface EffectiveWatchingUpdateConfig {
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  logRetentionCount: number;
  source: {
    cron: WatchingUpdateConfigSource;
    timezone: WatchingUpdateConfigSource;
    retention: WatchingUpdateConfigSource;
  };
}

function resolveCronExpression(
  userValue: unknown,
  systemValue: unknown,
): { value: string; source: WatchingUpdateConfigSource } {
  if (typeof userValue === 'string' && validateCronExpression(userValue)) {
    return {
      value: normalizeCronExpression(userValue),
      source: 'user',
    };
  }

  if (typeof systemValue === 'string' && validateCronExpression(systemValue)) {
    return {
      value: normalizeCronExpression(systemValue),
      source: 'system',
    };
  }

  return {
    value: DEFAULT_UPDATE_CHECK_CRON_EXPRESSION,
    source: 'default',
  };
}

function resolveTimezone(
  userValue: unknown,
  systemValue: unknown,
): { value: string; source: WatchingUpdateConfigSource } {
  if (typeof userValue === 'string' && validateTimezone(userValue)) {
    return {
      value: normalizeTimezone(userValue),
      source: 'user',
    };
  }

  if (typeof systemValue === 'string' && validateTimezone(systemValue)) {
    return {
      value: normalizeTimezone(systemValue),
      source: 'system',
    };
  }

  return {
    value: DEFAULT_SCHEDULER_TIMEZONE,
    source: 'default',
  };
}

function isValidRetentionCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_WATCHING_UPDATE_CHECK_LOG_LIMIT &&
    value <= MAX_WATCHING_UPDATE_CHECK_LOG_LIMIT
  );
}

function resolveRetentionCount(
  userValue: unknown,
  systemValue: unknown,
): { value: number; source: WatchingUpdateConfigSource } {
  if (isValidRetentionCount(userValue)) {
    return {
      value: normalizeWatchingUpdateCheckLogRetentionCount(userValue),
      source: 'user',
    };
  }

  if (isValidRetentionCount(systemValue)) {
    return {
      value: normalizeWatchingUpdateCheckLogRetentionCount(systemValue),
      source: 'system',
    };
  }

  return {
    value: DEFAULT_WATCHING_UPDATE_CHECK_LOG_LIMIT,
    source: 'default',
  };
}

export function resolveUserWatchingUpdateConfig(
  input: ResolveUserWatchingUpdateConfigInput,
): EffectiveWatchingUpdateConfig {
  const cron = resolveCronExpression(
    input.userConfig?.cronExpression,
    input.systemConfig?.updateCheckCronExpression,
  );
  const timezone = resolveTimezone(
    input.userConfig?.timezone,
    input.systemConfig?.updateCheckTimezone,
  );
  const retention = resolveRetentionCount(
    input.userConfig?.logRetentionCount,
    input.systemConfig?.updateCheckLogRetentionCount,
  );

  return {
    enabled:
      input.systemConfig?.updateCheckBackendEnabled === true &&
      input.userUpdateCheckBackendEnabled === true,
    cronExpression: cron.value,
    timezone: timezone.value,
    logRetentionCount: retention.value,
    source: {
      cron: cron.source,
      timezone: timezone.source,
      retention: retention.source,
    },
  };
}
