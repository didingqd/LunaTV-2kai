/** @jest-environment node */

import type { AdminConfig, UserWatchingUpdateConfig } from './admin.types';
import {
  UserWatchingUpdateConfigRepository,
  type UserWatchingUpdateConfigStore,
} from './user-watching-update-config-repository';

function createAdminConfig(): AdminConfig {
  return {
    UserConfig: {
      Users: [
        {
          username: 'alice',
          role: 'user',
          tags: ['family'],
          enabledApis: ['source-a'],
          updateCheckBackendEnabled: true,
        },
        { username: 'bob', role: 'admin' },
      ],
    },
  } as AdminConfig;
}

function cloneConfig(config: AdminConfig): AdminConfig {
  return JSON.parse(JSON.stringify(config)) as AdminConfig;
}

function createStore(initial = createAdminConfig()) {
  let stored = cloneConfig(initial);
  const saveAdminConfig = jest.fn(async (config: AdminConfig) => {
    stored = cloneConfig(config);
  });
  const store: UserWatchingUpdateConfigStore = {
    getAdminConfig: async () => cloneConfig(stored),
    saveAdminConfig,
  };
  return {
    store,
    saveAdminConfig,
    getStored: () => cloneConfig(stored),
  };
}

describe('UserWatchingUpdateConfigRepository', () => {
  it('creates and reads a user watching update config', async () => {
    const { store } = createStore();
    const repository = new UserWatchingUpdateConfigRepository(store);
    const config: UserWatchingUpdateConfig = {
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
    };

    await repository.updateUserWatchingUpdateConfig('alice', config);

    await expect(
      repository.getUserWatchingUpdateConfig('alice'),
    ).resolves.toEqual(config);
  });

  it('returns null when the user does not exist', async () => {
    const { store } = createStore();
    const repository = new UserWatchingUpdateConfigRepository(store);

    await expect(
      repository.getUserWatchingUpdateConfig('missing'),
    ).resolves.toBeNull();
    await expect(
      repository.updateUserWatchingUpdateConfig('missing', {}),
    ).rejects.toThrow('USER_NOT_FOUND');
    await expect(
      repository.clearUserWatchingUpdateConfig('missing'),
    ).rejects.toThrow('USER_NOT_FOUND');
  });

  it('updates only watchingUpdateConfig on the target user', async () => {
    const initial = createAdminConfig();
    const originalAlice = cloneConfig(initial).UserConfig.Users[0];
    const { store, getStored } = createStore(initial);
    const repository = new UserWatchingUpdateConfigRepository(store);

    await repository.updateUserWatchingUpdateConfig('alice', {
      logRetentionCount: 500,
    });

    expect(getStored().UserConfig.Users[0]).toEqual({
      ...originalAlice,
      watchingUpdateConfig: { logRetentionCount: 500 },
    });
    expect(getStored().UserConfig.Users[1]).toEqual(
      initial.UserConfig.Users[1],
    );
  });

  it('deletes the user watching update config', async () => {
    const initial = createAdminConfig();
    initial.UserConfig.Users[0].watchingUpdateConfig = {
      timezone: 'Asia/Shanghai',
    };
    const { store, getStored } = createStore(initial);
    const repository = new UserWatchingUpdateConfigRepository(store);

    await repository.clearUserWatchingUpdateConfig('alice');

    expect(
      getStored().UserConfig.Users[0].watchingUpdateConfig,
    ).toBeUndefined();
  });

  it('serializes concurrent AdminConfig writes', async () => {
    let stored = createAdminConfig();
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const store: UserWatchingUpdateConfigStore = {
      getAdminConfig: async () => cloneConfig(stored),
      saveAdminConfig: async (config) => {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        await new Promise((resolve) => setTimeout(resolve, 5));
        stored = cloneConfig(config);
        activeWrites -= 1;
      },
    };
    const repository = new UserWatchingUpdateConfigRepository(store);

    await Promise.all([
      repository.updateUserWatchingUpdateConfig('alice', {
        cronExpression: '0 * * * *',
      }),
      repository.updateUserWatchingUpdateConfig('bob', {
        timezone: 'Europe/Berlin',
      }),
    ]);

    expect(maxActiveWrites).toBe(1);
    expect(stored.UserConfig.Users[0].watchingUpdateConfig).toEqual({
      cronExpression: '0 * * * *',
    });
    expect(stored.UserConfig.Users[1].watchingUpdateConfig).toEqual({
      timezone: 'Europe/Berlin',
    });
  });

  it('supports a legacy user without watchingUpdateConfig', async () => {
    const { store, saveAdminConfig } = createStore();
    const repository = new UserWatchingUpdateConfigRepository(store);

    await expect(
      repository.getUserWatchingUpdateConfig('alice'),
    ).resolves.toBeNull();
    await repository.clearUserWatchingUpdateConfig('alice');
    expect(saveAdminConfig).not.toHaveBeenCalled();
  });
});
