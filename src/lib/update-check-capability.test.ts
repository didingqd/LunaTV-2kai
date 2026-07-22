/** @jest-environment node */

import type { SystemConfig } from './admin.types';
import { UpdateCheckCapabilityService } from './update-check-capability';

const config: SystemConfig = {
  updateCheckBackendEnabled: true,
  updateCheckCronInterval: 30 * 60 * 1000,
  updateCheckBatchSize: 100,
  updateCheckMaxUsers: 1000,
  updateCheckMaxFollowPerUser: 100,
};

function permissionRepository(enabledUsers: string[]) {
  return {
    isUserUpdateCheckAllowed: async (userId: string) =>
      userId === 'owner' || enabledUsers.includes(userId),
  };
}

describe('UpdateCheckCapabilityService', () => {
  it('keeps every user local when the global switch is disabled', async () => {
    const service = new UpdateCheckCapabilityService(
      {
        getUpdateCheckConfig: async () => ({
          ...config,
          updateCheckBackendEnabled: false,
        }),
      },
      permissionRepository(['alice']),
    );

    await expect(service.getCapability('alice')).resolves.toEqual({
      enabled: false,
      backendEnabled: false,
      userEnabled: false,
      mode: 'local',
      reason: 'backend_disabled',
    });
  });

  it('implicitly enables only the owner when no explicit permission exists', async () => {
    const service = new UpdateCheckCapabilityService(
      { getUpdateCheckConfig: async () => config },
      permissionRepository([]),
    );

    await expect(service.getCapability('owner')).resolves.toEqual({
      enabled: true,
      backendEnabled: true,
      userEnabled: true,
      mode: 'backend',
    });
    await expect(service.getCapability('alice')).resolves.toEqual({
      enabled: false,
      backendEnabled: true,
      userEnabled: false,
      mode: 'local',
      reason: 'user_not_enabled',
    });
  });

  it('enables an explicitly authorized user', async () => {
    const service = new UpdateCheckCapabilityService(
      { getUpdateCheckConfig: async () => config },
      permissionRepository(['alice']),
    );

    await expect(service.getCapability('alice')).resolves.toEqual({
      enabled: true,
      backendEnabled: true,
      userEnabled: true,
      mode: 'backend',
    });
  });
});
