/** @jest-environment node */

jest.mock('./latest-episode-provider', () => ({
  latestEpisodeProviderRegistry: { get: jest.fn() },
}));

import type { AdminConfig } from './admin.types';
import {
  UpdateCheckPermissionService,
  type UpdateCheckPermissionConfigStore,
} from './update-check-permission-service';

function adminConfig(): AdminConfig {
  return {
    UserConfig: {
      Users: [
        { username: 'owner', role: 'owner' },
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
        },
      ],
    },
  } as AdminConfig;
}

function configStore(config: AdminConfig, save = jest.fn()) {
  return {
    store: {
      getAdminConfig: async () => config,
      saveAdminConfig: save,
    } satisfies UpdateCheckPermissionConfigStore,
    save,
  };
}

const systemConfig = {
  getUpdateCheckConfig: async () => ({
    updateCheckBackendEnabled: false,
    updateCheckCronInterval: 30 * 60 * 1000,
    updateCheckBatchSize: 100,
    updateCheckMaxUsers: 1000,
    updateCheckMaxFollowPerUser: 100,
  }),
};

describe('UpdateCheckPermissionService AdminConfig storage', () => {
  it('persists user permission in the existing UserConfig entry', async () => {
    const config = adminConfig();
    const { store, save } = configStore(config);
    const onUserPermissionDisabled = jest.fn(async () => undefined);
    const service = new UpdateCheckPermissionService(
      store,
      systemConfig,
      {
        onUserPermissionEnabled: async () => undefined,
        onUserPermissionDisabled,
      },
      () => 1000,
      () => 'owner',
    );

    const permission = await service.setPermission('alice', false, 'admin');

    expect(config.UserConfig.Users[1]).toMatchObject({
      updateCheckBackendEnabled: false,
      updateCheckPermissionCreatedAt: 1000,
      updateCheckPermissionUpdatedAt: 1000,
      updateCheckPermissionOperator: 'admin',
    });
    expect(permission).toMatchObject({ userId: 'alice', enabled: false });
    expect(save).toHaveBeenCalledWith(config);
    expect(onUserPermissionDisabled).toHaveBeenCalledWith('alice');
  });

  it('cleans only owner and explicitly authorized update caches when disabled', async () => {
    const { store } = configStore(adminConfig());
    const onUserPermissionDisabled = jest.fn(async () => undefined);
    const service = new UpdateCheckPermissionService(
      store,
      systemConfig,
      {
        onUserPermissionEnabled: async () => undefined,
        onUserPermissionDisabled,
      },
      Date.now,
      () => 'owner',
    );

    await service.onSystemConfigChanged(false);

    expect(onUserPermissionDisabled).toHaveBeenCalledTimes(2);
    expect(onUserPermissionDisabled).toHaveBeenCalledWith('owner');
    expect(onUserPermissionDisabled).toHaveBeenCalledWith('alice');
  });

  it('persists a batch of user permissions in one config save', async () => {
    const config = adminConfig();
    config.UserConfig.Users.push({ username: 'bob', role: 'user' });
    const { store, save } = configStore(config);
    const onUserPermissionEnabled = jest.fn(async () => undefined);
    const service = new UpdateCheckPermissionService(
      store,
      systemConfig,
      {
        onUserPermissionEnabled,
        onUserPermissionDisabled: async () => undefined,
      },
      () => 1000,
      () => 'owner',
    );

    const permissions = await service.setPermissions(
      ['alice', 'bob'],
      true,
      'admin',
    );

    expect(permissions).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onUserPermissionEnabled).toHaveBeenCalledWith('alice');
    expect(onUserPermissionEnabled).toHaveBeenCalledWith('bob');
    expect(config.UserConfig.Users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: 'alice',
          updateCheckBackendEnabled: true,
        }),
        expect.objectContaining({
          username: 'bob',
          updateCheckBackendEnabled: true,
        }),
      ]),
    );
  });
});
