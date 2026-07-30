import type { SystemConfig, UserWatchingUpdateConfig } from './admin.types';
import { resolveUserWatchingUpdateConfig } from './user-watching-update-config-resolver';

const systemConfig: Partial<SystemConfig> = {
  updateCheckBackendEnabled: true,
  updateCheckCronExpression: '0 * * * *',
  updateCheckTimezone: 'Europe/Berlin',
  updateCheckLogRetentionCount: 500,
};

function resolve(
  userConfig?: UserWatchingUpdateConfig,
  overrides: Partial<
    Parameters<typeof resolveUserWatchingUpdateConfig>[0]
  > = {},
) {
  return resolveUserWatchingUpdateConfig({
    username: 'alice',
    userUpdateCheckBackendEnabled: true,
    systemConfig,
    userConfig,
    ...overrides,
  });
}

describe('resolveUserWatchingUpdateConfig', () => {
  it('inherits valid SystemConfig values when the user has no config', () => {
    expect(resolve()).toEqual({
      enabled: true,
      cronExpression: '0 * * * *',
      timezone: 'Europe/Berlin',
      logRetentionCount: 500,
      source: {
        cron: 'system',
        timezone: 'system',
        retention: 'system',
      },
    });
  });

  it('uses and normalizes a valid user cron expression', () => {
    const result = resolve({ cronExpression: '  */15   * * * * ' });

    expect(result.cronExpression).toBe('*/15 * * * *');
    expect(result.source.cron).toBe('user');
  });

  it('uses a valid user timezone', () => {
    const result = resolve({ timezone: ' Asia/Shanghai ' });

    expect(result.timezone).toBe('Asia/Shanghai');
    expect(result.source.timezone).toBe('user');
  });

  it('uses a valid user retention count', () => {
    const result = resolve({ logRetentionCount: 1200 });

    expect(result.logRetentionCount).toBe(1200);
    expect(result.source.retention).toBe('user');
  });

  it('ignores an invalid user cron and falls back to the system value', () => {
    const result = resolve({ cronExpression: 'abc' });

    expect(result.cronExpression).toBe('0 * * * *');
    expect(result.source.cron).toBe('system');
  });

  it('ignores an invalid user timezone and falls back to the system value', () => {
    const result = resolve({ timezone: 'invalid/timezone' });

    expect(result.timezone).toBe('Europe/Berlin');
    expect(result.source.timezone).toBe('system');
  });

  it.each([10, 10000])(
    'ignores an out-of-range user retention count: %s',
    (logRetentionCount) => {
      const result = resolve({ logRetentionCount });

      expect(result.logRetentionCount).toBe(500);
      expect(result.source.retention).toBe('system');
    },
  );

  it.each([
    { systemEnabled: false, userEnabled: true, expected: false },
    { systemEnabled: true, userEnabled: false, expected: false },
    { systemEnabled: true, userEnabled: undefined, expected: false },
    { systemEnabled: true, userEnabled: true, expected: true },
  ])(
    'applies the system and user permission AND rule',
    ({ systemEnabled, userEnabled, expected }) => {
      const result = resolve(undefined, {
        userUpdateCheckBackendEnabled: userEnabled,
        systemConfig: {
          ...systemConfig,
          updateCheckBackendEnabled: systemEnabled,
        },
      });

      expect(result.enabled).toBe(expected);
    },
  );

  it('supports a legacy user without watchingUpdateConfig', () => {
    expect(
      resolveUserWatchingUpdateConfig({
        username: 'legacy-user',
        userUpdateCheckBackendEnabled: true,
        systemConfig,
      }),
    ).toMatchObject({
      enabled: true,
      cronExpression: '0 * * * *',
      timezone: 'Europe/Berlin',
      logRetentionCount: 500,
    });
  });

  it('falls back to defaults with correct sources when all values are invalid', () => {
    const result = resolve(
      {
        cronExpression: 'invalid',
        timezone: 'invalid/timezone',
        logRetentionCount: 10,
      },
      {
        systemConfig: {
          updateCheckBackendEnabled: true,
          updateCheckCronExpression: '*/5 * * * * *',
          updateCheckTimezone: 'also/invalid',
          updateCheckLogRetentionCount: 10000,
        },
      },
    );

    expect(result).toMatchObject({
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
      logRetentionCount: 200,
      source: {
        cron: 'default',
        timezone: 'default',
        retention: 'default',
      },
    });
  });

  it('does not mutate the input objects', () => {
    const userConfig: UserWatchingUpdateConfig = {
      cronExpression: '  0 */6 * * * ',
      timezone: ' Asia/Tokyo ',
      logRetentionCount: 250,
    };
    const originalUserConfig = { ...userConfig };
    const originalSystemConfig = { ...systemConfig };

    resolve(userConfig);

    expect(userConfig).toEqual(originalUserConfig);
    expect(systemConfig).toEqual(originalSystemConfig);
  });
});
