import type { AdminConfig, SystemConfig } from './admin.types';
import { clearConfigCache, getConfig } from './config';
import { db } from './db';

export const DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG: SystemConfig = {
  updateCheckBackendEnabled: false,
  updateCheckCronInterval: 30 * 60 * 1000,
  updateCheckBatchSize: 100,
  updateCheckMaxUsers: 1000,
  updateCheckMaxFollowPerUser: 100,
};

export const UPDATE_CHECK_CRON_INTERVAL_OPTIONS = [
  30 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

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
    updateCheckCronInterval: UPDATE_CHECK_CRON_INTERVAL_OPTIONS.includes(
      value?.updateCheckCronInterval as (typeof UPDATE_CHECK_CRON_INTERVAL_OPTIONS)[number],
    )
      ? (value?.updateCheckCronInterval as number)
      : DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckCronInterval,
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
    const normalized = normalizeUpdateCheckSystemConfig(value);
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
