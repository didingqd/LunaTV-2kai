/** @jest-environment node */

import type { AdminConfig } from './admin.types';
import {
  AdminSystemConfigRepository,
  DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG,
  normalizeUpdateCheckSystemConfig,
} from './system-config-repository';

describe('AdminSystemConfigRepository', () => {
  it('normalizes the supported cron intervals and rejects unknown values', () => {
    expect(
      normalizeUpdateCheckSystemConfig({
        updateCheckCronInterval: 6 * 60 * 60 * 1000,
      }).updateCheckCronInterval,
    ).toBe(6 * 60 * 60 * 1000);
    expect(
      normalizeUpdateCheckSystemConfig({
        updateCheckCronInterval: 123,
      }).updateCheckCronInterval,
    ).toBe(DEFAULT_UPDATE_CHECK_SYSTEM_CONFIG.updateCheckCronInterval);
  });

  it('returns the exact normalized configuration after saving it', async () => {
    let stored = { ConfigFile: 'preserved' } as AdminConfig;
    const repository = new AdminSystemConfigRepository({
      getAdminConfig: async () => stored,
      saveAdminConfig: async (config) => {
        stored = config;
      },
    });
    const expected = {
      updateCheckBackendEnabled: true,
      updateCheckCronInterval: 12 * 60 * 60 * 1000,
      updateCheckBatchSize: 50,
      updateCheckMaxUsers: 200,
      updateCheckMaxFollowPerUser: 25,
    };

    await expect(repository.saveUpdateCheckConfig(expected)).resolves.toEqual(
      expected,
    );
    await expect(repository.getUpdateCheckConfig()).resolves.toEqual(expected);
    expect(stored.ConfigFile).toBe('preserved');
  });

  it('reads authorized users from AdminConfig UserConfig', async () => {
    const config = {
      UserConfig: {
        Users: [
          { username: 'owner', role: 'owner' },
          {
            username: 'alice',
            role: 'user',
            updateCheckBackendEnabled: true,
          },
          { username: 'bob', role: 'admin' },
        ],
      },
    } as AdminConfig;
    const repository = new AdminSystemConfigRepository(
      {
        getAdminConfig: async () => config,
        saveAdminConfig: async () => undefined,
      },
      async () => config,
    );
    const previousOwner = process.env.USERNAME;
    process.env.USERNAME = 'owner';

    await expect(repository.isUserUpdateCheckAllowed('owner')).resolves.toBe(
      true,
    );
    await expect(repository.isUserUpdateCheckAllowed('alice')).resolves.toBe(
      true,
    );
    await expect(repository.isUserUpdateCheckAllowed('bob')).resolves.toBe(
      false,
    );
    await expect(repository.listUpdateCheckEnabledUserIds()).resolves.toEqual([
      'alice',
    ]);

    if (previousOwner === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = previousOwner;
  });
});
