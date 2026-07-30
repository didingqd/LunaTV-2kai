import type { AdminConfig, UserWatchingUpdateConfig } from './admin.types';

const getAllUsers = jest.fn();
const getUserInfoV2 = jest.fn();

jest.mock('next/cache', () => ({
  unstable_noStore: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getAllUsers: (...args: unknown[]) => getAllUsers(...args),
    getUserInfoV2: (...args: unknown[]) => getUserInfoV2(...args),
  },
}));

import { configSelfCheck } from './config';

describe('configSelfCheck user watching update config', () => {
  const originalUsername = process.env.USERNAME;

  beforeEach(() => {
    process.env.USERNAME = 'owner';
    getAllUsers.mockResolvedValue(['owner']);
    getUserInfoV2.mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalUsername === undefined) {
      delete process.env.USERNAME;
    } else {
      process.env.USERNAME = originalUsername;
    }
  });

  it('preserves the owner watchingUpdateConfig during owner reconstruction', async () => {
    const watchingUpdateConfig: UserWatchingUpdateConfig = {
      cronExpression: '0 */6 * * *',
      timezone: 'Asia/Shanghai',
      logRetentionCount: 750,
      updatedAt: 123456789,
      operator: 'owner',
    };
    const config = {
      UserConfig: {
        Users: [
          {
            username: 'owner',
            role: 'owner',
            watchingUpdateConfig,
          },
        ],
      },
      SourceConfig: [],
      CustomCategories: [],
      LiveConfig: [],
    } as unknown as AdminConfig;

    const result = await configSelfCheck(config);

    expect(result.UserConfig.Users[0]).toMatchObject({
      username: 'owner',
      role: 'owner',
      watchingUpdateConfig,
    });
  });
});
