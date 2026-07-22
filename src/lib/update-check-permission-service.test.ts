/** @jest-environment node */

jest.mock('./latest-episode-provider', () => ({
  latestEpisodeProviderRegistry: { get: jest.fn() },
}));

import { UpdateCheckPermissionService } from './update-check-permission-service';
import type { UpdateCheckUserPermissionRepository } from './update-check-permission-repository';

function permissions(): UpdateCheckUserPermissionRepository {
  return {
    get: async () => null,
    getAll: async () => [],
    save: async () => undefined,
    listEnabledUserIds: async () => ['alice'],
  };
}

describe('UpdateCheckPermissionService system switch lifecycle', () => {
  it('cleans only owner and explicitly authorized update caches when disabled', async () => {
    const onUserPermissionDisabled = jest.fn(async () => undefined);
    const service = new UpdateCheckPermissionService(
      permissions(),
      {
        getUpdateCheckConfig: async () => ({
          updateCheckBackendEnabled: false,
          updateCheckCronInterval: 30 * 60 * 1000,
          updateCheckBatchSize: 100,
          updateCheckMaxUsers: 1000,
          updateCheckMaxFollowPerUser: 100,
        }),
      },
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
});
