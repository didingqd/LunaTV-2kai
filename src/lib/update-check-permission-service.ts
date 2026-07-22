import type { SystemConfig } from './admin.types';
import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
} from './system-config-repository';
import {
  updateCheckUserPermissionRepository,
  type UpdateCheckUserPermission,
  type UpdateCheckUserPermissionRepository,
} from './update-check-permission-repository';
import {
  updateCheckService,
  type UpdateCheckService,
} from './update-check-service';

export class UpdateCheckPermissionService {
  constructor(
    private readonly permissions: UpdateCheckUserPermissionRepository = updateCheckUserPermissionRepository,
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

    const timestamp = this.now();
    const previous = await this.permissions.get(userId);
    const permission: UpdateCheckUserPermission = {
      userId,
      enabled,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      operator,
    };
    await this.permissions.save(permission);
    if (enabled) await this.checks.onUserPermissionEnabled(userId);
    else await this.checks.onUserPermissionDisabled(userId);
    return permission;
  }

  async onSystemConfigChanged(enabled: boolean): Promise<void> {
    const [authorizedUsers, config] = await Promise.all([
      this.permissions.listEnabledUserIds(),
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
    const [permissions, config] = await Promise.all([
      this.permissions.getAll(),
      systemConfig
        ? Promise.resolve(systemConfig)
        : this.config.getUpdateCheckConfig(),
    ]);
    const permissionByUser = new Map(
      permissions.map((permission) => [permission.userId, permission]),
    );
    return userIds.map((userId) => {
      const permission = permissionByUser.get(userId);
      const owner = userId === this.ownerId();
      const granted = owner || permission?.enabled === true;
      return {
        userId,
        owner,
        granted,
        enabled: config.updateCheckBackendEnabled && granted,
        mode:
          config.updateCheckBackendEnabled && granted
            ? ('backend' as const)
            : ('local' as const),
        updatedAt: permission?.updatedAt ?? null,
        operator: permission?.operator ?? null,
      };
    });
  }
}

export const updateCheckPermissionService = new UpdateCheckPermissionService();
