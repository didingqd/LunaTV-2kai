import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
} from './system-config-repository';
import {
  updateCheckUserPermissionRepository,
  type UpdateCheckUserPermissionRepository,
} from './update-check-permission-repository';

export interface UpdateCheckCapability {
  enabled: boolean;
  backendEnabled: boolean;
  userEnabled: boolean;
  mode: 'backend' | 'local';
  reason?: 'backend_disabled' | 'user_not_enabled';
}

export interface UpdateCheckCapabilityReader {
  getCapability(userId: string): Promise<UpdateCheckCapability>;
}

export class UpdateCheckCapabilityService implements UpdateCheckCapabilityReader {
  constructor(
    private readonly config: UpdateCheckConfigReader = systemConfigRepository,
    private readonly permissions: UpdateCheckUserPermissionRepository = updateCheckUserPermissionRepository,
    private readonly ownerId: () => string | undefined = () =>
      process.env.USERNAME,
  ) {}

  async getCapability(userId: string): Promise<UpdateCheckCapability> {
    const config = await this.config.getUpdateCheckConfig();
    if (!config.updateCheckBackendEnabled) {
      return {
        enabled: false,
        backendEnabled: false,
        userEnabled: false,
        mode: 'local',
        reason: 'backend_disabled',
      };
    }

    if (
      userId === this.ownerId() ||
      (await this.permissions.get(userId))?.enabled
    ) {
      return {
        enabled: true,
        backendEnabled: true,
        userEnabled: true,
        mode: 'backend',
      };
    }
    return {
      enabled: false,
      backendEnabled: true,
      userEnabled: false,
      mode: 'local',
      reason: 'user_not_enabled',
    };
  }
}

export const updateCheckCapabilityService = new UpdateCheckCapabilityService();
