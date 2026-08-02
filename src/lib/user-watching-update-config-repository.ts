import type { AdminConfig, UserWatchingUpdateConfig } from './admin.types';
import { db } from './db';

export interface UserWatchingUpdateConfigStore {
  getAdminConfig(): Promise<AdminConfig | null>;
  saveAdminConfig(config: AdminConfig): Promise<void>;
}

export interface UserWatchingUpdateConfigRepositoryContract {
  getUserWatchingUpdateConfig(
    username: string,
  ): Promise<UserWatchingUpdateConfig | null>;
  updateUserWatchingUpdateConfig(
    username: string,
    config: UserWatchingUpdateConfig,
  ): Promise<void>;
  clearUserWatchingUpdateConfig(username: string): Promise<void>;
}

function copyUserWatchingUpdateConfig(
  config: UserWatchingUpdateConfig,
): UserWatchingUpdateConfig {
  return {
    ...config,
    ...(config.triggerLink
      ? { triggerLink: { ...config.triggerLink } }
      : undefined),
    ...(config.triggerLinkAccessControl
      ? {
          triggerLinkAccessControl: {
            ...config.triggerLinkAccessControl,
            ...(config.triggerLinkAccessControl.ipLimit
              ? { ipLimit: { ...config.triggerLinkAccessControl.ipLimit } }
              : undefined),
            ...(config.triggerLinkAccessControl.userLimit
              ? { userLimit: { ...config.triggerLinkAccessControl.userLimit } }
              : undefined),
            ...(config.triggerLinkAccessControl.autoDisable
              ? {
                  autoDisable: {
                    ...config.triggerLinkAccessControl.autoDisable,
                  },
                }
              : undefined),
          },
        }
      : undefined),
  };
}

export class UserWatchingUpdateConfigRepository implements UserWatchingUpdateConfigRepositoryContract {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: UserWatchingUpdateConfigStore = db) {}

  async getUserWatchingUpdateConfig(
    username: string,
  ): Promise<UserWatchingUpdateConfig | null> {
    const adminConfig = await this.store.getAdminConfig();
    const config = adminConfig?.UserConfig.Users.find(
      (user) => user.username === username,
    )?.watchingUpdateConfig;
    return config ? copyUserWatchingUpdateConfig(config) : null;
  }

  async updateUserWatchingUpdateConfig(
    username: string,
    config: UserWatchingUpdateConfig,
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      const adminConfig = await this.store.getAdminConfig();
      const userIndex =
        adminConfig?.UserConfig.Users.findIndex(
          (user) => user.username === username,
        ) ?? -1;
      if (!adminConfig || userIndex < 0) throw new Error('USER_NOT_FOUND');

      const users = [...adminConfig.UserConfig.Users];
      users[userIndex] = {
        ...users[userIndex],
        watchingUpdateConfig: copyUserWatchingUpdateConfig(config),
      };
      await this.store.saveAdminConfig({
        ...adminConfig,
        UserConfig: {
          ...adminConfig.UserConfig,
          Users: users,
        },
      });
    });
  }

  async clearUserWatchingUpdateConfig(username: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const adminConfig = await this.store.getAdminConfig();
      const userIndex =
        adminConfig?.UserConfig.Users.findIndex(
          (user) => user.username === username,
        ) ?? -1;
      if (!adminConfig || userIndex < 0) throw new Error('USER_NOT_FOUND');
      if (!adminConfig.UserConfig.Users[userIndex].watchingUpdateConfig) return;

      const users = [...adminConfig.UserConfig.Users];
      const user = { ...users[userIndex] };
      delete user.watchingUpdateConfig;
      users[userIndex] = user;
      await this.store.saveAdminConfig({
        ...adminConfig,
        UserConfig: {
          ...adminConfig.UserConfig,
          Users: users,
        },
      });
    });
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(operation);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export const userWatchingUpdateConfigRepository =
  new UserWatchingUpdateConfigRepository();
