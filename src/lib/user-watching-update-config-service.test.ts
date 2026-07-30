/** @jest-environment node */

import type { UserWatchingUpdateConfig } from './admin.types';
import type { UserWatchingUpdateConfigRepositoryContract } from './user-watching-update-config-repository';
import { UserWatchingUpdateConfigService } from './user-watching-update-config-service';

class MemoryRepository implements UserWatchingUpdateConfigRepositoryContract {
  readonly users = new Set(['alice', 'legacy']);
  readonly configs = new Map<string, UserWatchingUpdateConfig>();

  async getUserWatchingUpdateConfig(
    username: string,
  ): Promise<UserWatchingUpdateConfig | null> {
    const config = this.configs.get(username);
    return config ? { ...config } : null;
  }

  async updateUserWatchingUpdateConfig(
    username: string,
    config: UserWatchingUpdateConfig,
  ): Promise<void> {
    if (!this.users.has(username)) throw new Error('USER_NOT_FOUND');
    this.configs.set(username, { ...config });
  }

  async clearUserWatchingUpdateConfig(username: string): Promise<void> {
    if (!this.users.has(username)) throw new Error('USER_NOT_FOUND');
    this.configs.delete(username);
  }
}

describe('UserWatchingUpdateConfigService', () => {
  let repository: MemoryRepository;
  let service: UserWatchingUpdateConfigService;

  beforeEach(() => {
    repository = new MemoryRepository();
    service = new UserWatchingUpdateConfigService(repository);
  });

  it('normalizes and saves a valid cron expression', async () => {
    await expect(
      service.updateUserWatchingUpdateConfig('alice', {
        cronExpression: '  */30   * * * * ',
      }),
    ).resolves.toMatchObject({ cronExpression: '*/30 * * * *' });
  });

  it('rejects an invalid cron expression', async () => {
    await expect(
      service.updateUserWatchingUpdateConfig('alice', {
        cronExpression: 'invalid',
      }),
    ).rejects.toThrow('INVALID_CRON_EXPRESSION');
    expect(repository.configs.has('alice')).toBe(false);
  });

  it('normalizes and saves a valid timezone', async () => {
    await expect(
      service.updateUserWatchingUpdateConfig('alice', {
        timezone: ' Asia/Shanghai ',
      }),
    ).resolves.toMatchObject({ timezone: 'Asia/Shanghai' });
  });

  it('rejects an invalid timezone', async () => {
    await expect(
      service.updateUserWatchingUpdateConfig('alice', {
        timezone: 'invalid/timezone',
      }),
    ).rejects.toThrow('INVALID_TIMEZONE');
  });

  it.each([50, 5000])('accepts retention boundary %s', async (value) => {
    await expect(
      service.updateUserWatchingUpdateConfig('alice', {
        logRetentionCount: value,
      }),
    ).resolves.toMatchObject({ logRetentionCount: value });
  });

  it.each([49, 5001, 5.5])(
    'rejects invalid retention value %s',
    async (value) => {
      await expect(
        service.updateUserWatchingUpdateConfig('alice', {
          logRetentionCount: value,
        }),
      ).rejects.toThrow('INVALID_LOG_RETENTION_COUNT');
    },
  );

  it('merges a partial update without replacing other fields', async () => {
    repository.configs.set('alice', {
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
    });

    await expect(
      service.updateUserWatchingUpdateConfig('alice', {
        timezone: 'Europe/Berlin',
      }),
    ).resolves.toEqual({
      cronExpression: '*/30 * * * *',
      timezone: 'Europe/Berlin',
    });
  });

  it('clears one field and preserves remaining overrides', async () => {
    repository.configs.set('alice', {
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
    });

    await expect(
      service.clearUserWatchingUpdateConfigField('alice', 'cronExpression'),
    ).resolves.toEqual({ timezone: 'UTC' });
    expect(repository.configs.get('alice')).toEqual({ timezone: 'UTC' });
  });

  it('removes the whole config when only metadata remains', async () => {
    repository.configs.set('alice', {
      cronExpression: '*/30 * * * *',
      updatedAt: 1000,
      operator: 'admin',
    });

    await expect(
      service.clearUserWatchingUpdateConfigField('alice', 'cronExpression'),
    ).resolves.toBeNull();
    expect(repository.configs.has('alice')).toBe(false);
  });

  it('clears all user overrides', async () => {
    repository.configs.set('alice', {
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
      logRetentionCount: 200,
    });

    await service.clearUserWatchingUpdateConfig('alice');

    expect(repository.configs.has('alice')).toBe(false);
  });

  it('reads a legacy user without an override as null', async () => {
    await expect(
      service.getUserWatchingUpdateConfig('legacy'),
    ).resolves.toBeNull();
  });

  it('does not accept triggerLink through the strategy update method', async () => {
    await expect(
      service.updateUserWatchingUpdateConfig('alice', {
        triggerLink: { enabled: true },
      } as UserWatchingUpdateConfig),
    ).rejects.toThrow('UNSUPPORTED_USER_WATCHING_UPDATE_CONFIG_FIELD');
  });
});
