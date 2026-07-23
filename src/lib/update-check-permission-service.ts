import type { AdminConfig, SystemConfig } from './admin.types';
import { clearConfigCache, getConfig } from './config';
import { db } from './db';
import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
} from './system-config-repository';
import {
  updateCheckService,
  type UpdateCheckService,
} from './update-check-service';

export interface UpdateCheckUserPermission {
  userId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  operator: string;
}

export interface UpdateCheckPermissionConfigStore {
  getAdminConfig(): Promise<AdminConfig>;
  saveAdminConfig(config: AdminConfig): Promise<void>;
}

const adminConfigPermissionStore: UpdateCheckPermissionConfigStore = {
  getAdminConfig: getConfig,
  async saveAdminConfig(config) {
    await db.saveAdminConfig(config);
    clearConfigCache();
  },
};

export class UpdateCheckPermissionService {
  constructor(
    private readonly store: UpdateCheckPermissionConfigStore = adminConfigPermissionStore,
    private readonly config: UpdateCheckConfigReader = systemConfigRepository,
    private readonly checks: Pick<
      UpdateCheckService,
      'onUserPermissionEnabled' | 'onUserPermissionDisabled'
    > = updateCheckService,
    private readonly now: () => number = Date.now,
    private readonly ownerId: () => string | undefined = () =>
      process.env.USERNAME,
  ) {}

  async setPermission(
    userId: string,
    enabled: boolean,
    operator: string,
  ): Promise<UpdateCheckUserPermission | null> {
    if (userId === this.ownerId()) {
      if (!enabled) throw new Error('OWNER_PERMISSION_IMPLICIT');
      await this.checks.onUserPermissionEnabled(userId);
      return null;
    }

    const config = await this.store.getAdminConfig();
    const user = config.UserConfig.Users.find(
      (candidate) => candidate.username === userId,
    );
    if (!user) throw new Error('USER_NOT_FOUND');

    const timestamp = this.now();
    const permission: UpdateCheckUserPermission = {
      userId,
      enabled,
      createdAt: user.updateCheckPermissionCreatedAt ?? timestamp,
      updatedAt: timestamp,
      operator,
    };
    user.updateCheckBackendEnabled = enabled;
    user.updateCheckPermissionCreatedAt = permission.createdAt;
    user.updateCheckPermissionUpdatedAt = permission.updatedAt;
    user.updateCheckPermissionOperator = operator;
    await this.store.saveAdminConfig(config);

    if (enabled) await this.checks.onUserPermissionEnabled(userId);
    else await this.checks.onUserPermissionDisabled(userId);
    return permission;
  }

  async setPermissions(
    userIds: string[],
    enabled: boolean,
    operator: string,
  ): Promise<UpdateCheckUserPermission[]> {
    const config = await this.store.getAdminConfig();
    const ownerId = this.ownerId();
    const users = userIds.map((userId) => {
      const user = config.UserConfig.Users.find(
        (candidate) => candidate.username === userId,
      );
      if (!user) throw new Error('USER_NOT_FOUND');
      if (userId === ownerId || user.role === 'owner') {
        if (!enabled) throw new Error('OWNER_PERMISSION_IMPLICIT');
        return null;
      }

      const timestamp = this.now();
      const permission: UpdateCheckUserPermission = {
        userId,
        enabled,
        createdAt: user.updateCheckPermissionCreatedAt ?? timestamp,
        updatedAt: timestamp,
        operator,
      };
      user.updateCheckBackendEnabled = enabled;
      user.updateCheckPermissionCreatedAt = permission.createdAt;
      user.updateCheckPermissionUpdatedAt = permission.updatedAt;
      user.updateCheckPermissionOperator = operator;
      return permission;
    });

    const changed = users.filter(
      (permission): permission is UpdateCheckUserPermission =>
        permission !== null,
    );
    if (changed.length > 0) await this.store.saveAdminConfig(config);
    await Promise.all(
      changed.map((permission) =>
        permission.enabled
          ? this.checks.onUserPermissionEnabled(permission.userId)
          : this.checks.onUserPermissionDisabled(permission.userId),
      ),
    );
    return changed;
  }

  async isUserAllowed(userId: string): Promise<boolean> {
    if (userId === this.ownerId()) return true;
    const config = await this.store.getAdminConfig();
    return (
      config.UserConfig.Users.find((user) => user.username === userId)
        ?.updateCheckBackendEnabled === true
    );
  }

  async listEnabledUserIds(): Promise<string[]> {
    const config = await this.store.getAdminConfig();
    return config.UserConfig.Users.filter(
      (user) => user.updateCheckBackendEnabled === true,
    ).map((user) => user.username);
  }

  async onSystemConfigChanged(enabled: boolean): Promise<void> {
    const [authorizedUsers, config] = await Promise.all([
      this.listEnabledUserIds(),
      this.config.getUpdateCheckConfig(),
    ]);
    const ownerId = this.ownerId();
    const userIds = [
      ...(ownerId ? [ownerId] : []),
      ...authorizedUsers.filter((userId) => userId !== ownerId),
    ];
    const selected = enabled
      ? userIds.slice(0, config.updateCheckMaxUsers)
      : userIds;
    let cursor = 0;
    const worker = async () => {
      while (cursor < selected.length) {
        const userId = selected[cursor++];
        if (enabled) await this.checks.onUserPermissionEnabled(userId);
        else await this.checks.onUserPermissionDisabled(userId);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(5, selected.length) }, worker),
    );
  }

  async listUsers(userIds: string[], systemConfig?: SystemConfig) {
    const [adminConfig, config] = await Promise.all([
      this.store.getAdminConfig(),
      systemConfig
        ? Promise.resolve(systemConfig)
        : this.config.getUpdateCheckConfig(),
    ]);
    const userById = new Map(
      adminConfig.UserConfig.Users.map((user) => [user.username, user]),
    );
    return userIds.map((userId) => {
      const user = userById.get(userId);
      const owner = userId === this.ownerId();
      const granted = owner || user?.updateCheckBackendEnabled === true;
      return {
        userId,
        owner,
        granted,
        enabled: config.updateCheckBackendEnabled && granted,
        mode:
          config.updateCheckBackendEnabled && granted
            ? ('backend' as const)
            : ('local' as const),
        updatedAt: user?.updateCheckPermissionUpdatedAt ?? null,
        operator: user?.updateCheckPermissionOperator ?? null,
      };
    });
  }
}

export const updateCheckPermissionService = new UpdateCheckPermissionService();
