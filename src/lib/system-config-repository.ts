import type { AdminConfig, SystemConfig } from './admin.types';
import { clearConfigCache, getConfig } from './config';
import { db } from './db';
import {
  DEFAULT_UPDATE_CHECK_CRON_EXPRESSION,
  normalizeCronExpression,
  validateCronExpression,
} from './scheduler/cron-utils';
import {
  DEFAULT_SCHEDULER_TIMEZONE,
  normalizeTimezone,
  validateTimezone,
} from './scheduler/timezone-utils';

export const DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG: SystemConfig = {
  updateCheckBackendEnabled: false,
  updateCheckSchedulerEnabled: true,
  updateCheckCronExpression: DEFAULT_UPDATE_CHECK_CRON_EXPRESSION,
  updateCheckTimezone: DEFAULT_SCHEDULER_TIMEZONE,
  updateCheckLogRetentionCount: 200,
  updateCheckBatchSize: 100,
  updateCheckMaxUsers: 1000,
  updateCheckMaxFollowPerUser: 100,
};

export interface SystemConfigStore {
  getAdminConfig(): Promise<AdminConfig | null>;
  saveAdminConfig(config: AdminConfig): Promise<void>;
}

export interface UpdateCheckConfigReader {
  getUpdateCheckConfig(): Promise<SystemConfig>;
}

export interface UpdateCheckUserAccessReader {
  isUserUpdateCheckAllowed(userId: string): Promise<boolean>;
  listUpdateCheckEnabledUserIds(): Promise<string[]>;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizeUpdateCheckSystemConfig(
  value: Partial<SystemConfig> | null | undefined,
): SystemConfig {
  return {
    updateCheckBackendEnabled: value?.updateCheckBackendEnabled === true,
    updateCheckSchedulerEnabled:
      value?.updateCheckSchedulerEnabled === undefined
        ? DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckSchedulerEnabled
        : value.updateCheckSchedulerEnabled === true,
    updateCheckCronExpression: normalizeCronExpression(
      value?.updateCheckCronExpression,
      DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckCronExpression,
    ),
    updateCheckTimezone: normalizeTimezone(
      value?.updateCheckTimezone,
      DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckTimezone,
    ),
    updateCheckLogRetentionCount: boundedInteger(
      value?.updateCheckLogRetentionCount,
      DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckLogRetentionCount,
      50,
      5000,
    ),
    updateCheckBatchSize: boundedInteger(
      value?.updateCheckBatchSize,
      DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckBatchSize,
      1,
      500,
    ),
    updateCheckMaxUsers: boundedInteger(
      value?.updateCheckMaxUsers,
      DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckMaxUsers,
      1,
      10000,
    ),
    updateCheckMaxFollowPerUser: boundedInteger(
      value?.updateCheckMaxFollowPerUser,
      DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckMaxFollowPerUser,
      1,
      1000,
    ),
  };
}

export function validateUpdateCheckSystemConfigForSave(
  value: Partial<SystemConfig> | null | undefined,
): SystemConfig {
  const cronExpression =
    typeof value?.updateCheckCronExpression === 'string'
      ? value.updateCheckCronExpression.trim().replace(/\s+/g, ' ')
      : '';
  const timezone =
    typeof value?.updateCheckTimezone === 'string'
      ? value.updateCheckTimezone.trim()
      : '';

  if (!validateCronExpression(cronExpression)) {
    throw new Error('Invalid update check cron expression');
  }
  if (!validateTimezone(timezone)) {
    throw new Error('Invalid update check timezone');
  }

  return {
    ...normalizeUpdateCheckSystemConfig(value),
    updateCheckCronExpression: cronExpression,
    updateCheckTimezone: timezone,
  };
}

export class AdminSystemConfigRepository
  implements UpdateCheckConfigReader, UpdateCheckUserAccessReader
{
  constructor(
    private readonly store: SystemConfigStore = db,
    private readonly loadFullConfig: () => Promise<AdminConfig> = getConfig,
  ) {}

  async getUpdateCheckConfig(): Promise<SystemConfig> {
    try {
      const config = await this.store.getAdminConfig();
      return normalizeUpdateCheckSystemConfig(config?.SystemConfig);
    } catch {
      return DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG;
    }
  }

  async saveUpdateCheckConfig(value: SystemConfig): Promise<SystemConfig> {
    const normalized = validateUpdateCheckSystemConfigForSave(value);
    const config =
      (await this.store.getAdminConfig()) ?? (await this.loadFullConfig());
    config.SystemConfig = normalized;
    await this.store.saveAdminConfig(config);
    clearConfigCache();
    return normalized;
  }

  async isUserUpdateCheckAllowed(userId: string): Promise<boolean> {
    if (userId === process.env.USERNAME) return true;
    const config = await this.loadFullConfig();
    return (
      config.UserConfig.Users.find((user) => user.username === userId)
        ?.updateCheckBackendEnabled === true
    );
  }

  async listUpdateCheckEnabledUserIds(): Promise<string[]> {
    const config = await this.loadFullConfig();
    return config.UserConfig.Users.filter(
      (user) => user.updateCheckBackendEnabled === true,
    ).map((user) => user.username);
  }
}

export const systemConfigRepository = new AdminSystemConfigRepository();
