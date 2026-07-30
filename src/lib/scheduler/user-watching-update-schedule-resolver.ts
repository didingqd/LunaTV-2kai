import type { SystemConfig, UserWatchingUpdateConfig } from '@/lib/admin.types';
import {
  getNextRun,
  normalizeCronExpression,
  validateCronExpression,
} from '@/lib/scheduler/cron-utils';
import {
  normalizeTimezone,
  validateTimezone,
} from '@/lib/scheduler/timezone-utils';
import { resolveUserWatchingUpdateConfig } from '@/lib/user-watching-update-config-resolver';

type UserWatchingUpdateScheduleSource = 'user' | 'system' | 'default';

export interface ResolveUserWatchingUpdateScheduleInput {
  username: string;
  userUpdateCheckBackendEnabled?: boolean;
  isOwner?: boolean;
  systemConfig?: Partial<SystemConfig> | null;
  userConfig?: UserWatchingUpdateConfig | null;
  from?: Date;
}

export interface EffectiveUserWatchingUpdateSchedule {
  username: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  nextRunAt: number | null;
  source: {
    cron: UserWatchingUpdateScheduleSource;
    timezone: UserWatchingUpdateScheduleSource;
  };
}

export function resolveUserWatchingUpdateSchedule(
  input: ResolveUserWatchingUpdateScheduleInput,
): EffectiveUserWatchingUpdateSchedule {
  const effective = resolveUserWatchingUpdateConfig({
    username: input.username,
    userUpdateCheckBackendEnabled:
      input.isOwner === true || input.userUpdateCheckBackendEnabled === true,
    systemConfig: input.systemConfig,
    userConfig: input.userConfig,
  });
  const cronExpression = validateCronExpression(effective.cronExpression)
    ? normalizeCronExpression(effective.cronExpression)
    : normalizeCronExpression(undefined);
  const timezone = validateTimezone(effective.timezone)
    ? normalizeTimezone(effective.timezone)
    : normalizeTimezone(undefined);
  const enabled =
    effective.enabled &&
    input.systemConfig?.updateCheckSchedulerEnabled !== false;
  const nextRun = enabled
    ? getNextRun(cronExpression, timezone, input.from ?? new Date())
    : null;

  return {
    username: input.username,
    enabled,
    cronExpression,
    timezone,
    nextRunAt: nextRun?.getTime() ?? null,
    source: {
      cron: effective.source.cron,
      timezone: effective.source.timezone,
    },
  };
}
