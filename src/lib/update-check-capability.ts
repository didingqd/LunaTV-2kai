import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
  type UpdateCheckUserAccessReader,
} from './system-config-repository';

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
    private readonly permissions: Pick<
      UpdateCheckUserAccessReader,
      'isUserUpdateCheckAllowed'
    > = systemConfigRepository,
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

    if (await this.permissions.isUserUpdateCheckAllowed(userId)) {
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
