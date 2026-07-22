import type { AdminConfig, SystemConfig } from './admin.types';
import { clearConfigCache, getConfig } from './config';
import { db } from './db';

export const DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG: SystemConfig = {
  updateCheckBackendEnabled: false,
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

export class AdminSystemConfigRepository implements UpdateCheckConfigReader {
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
}

export const systemConfigRepository = new AdminSystemConfigRepository();
