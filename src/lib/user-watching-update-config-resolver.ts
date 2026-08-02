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

type WatchingUpdateConfigSource = 'user' | 'system' | 'default';

export interface ResolveUserWatchingUpdateConfigInput {
  username: string;
  userUpdateCheckBackendEnabled?: boolean;
  allowCustomSchedule?: boolean;
  systemConfig?: Partial<SystemConfig> | null;
  userConfig?: UserWatchingUpdateConfig | null;
}

export interface EffectiveWatchingUpdateConfig {
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  source: {
    cron: WatchingUpdateConfigSource;
    timezone: WatchingUpdateConfigSource;
  };
  permissions: {
    allowCustomSchedule: boolean;
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

  return {
    enabled:
      input.systemConfig?.updateCheckBackendEnabled === true &&
      input.userUpdateCheckBackendEnabled === true,
    cronExpression: cron.value,
    timezone: timezone.value,
    source: {
      cron: cron.source,
      timezone: timezone.source,
    },
    permissions: {
      allowCustomSchedule: input.allowCustomSchedule !== false,
    },
  };
}
