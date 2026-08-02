jest.mock('./db', () => ({
  db: {},
}));
jest.mock('./config', () => ({
  clearConfigCache: jest.fn(),
}));

import type { UserWatchingUpdateConfig } from './admin.types';
import {
  TriggerLinkAccessControlService,
  type TriggerLinkAccessControlStore,
} from './trigger-link-access-control-service';
import type { UserWatchingUpdateConfigRepositoryContract } from './user-watching-update-config-repository';

class MemoryStore implements TriggerLinkAccessControlStore {
  readonly values = new Map<string, unknown>();

  async getCache(key: string): Promise<unknown | null> {
    return this.values.get(key) ?? null;
  }

  async setCache(key: string, data: unknown): Promise<void> {
    this.values.set(key, data);
  }

  async deleteCache(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class MemoryConfigRepository implements UserWatchingUpdateConfigRepositoryContract {
  constructor(private readonly config: UserWatchingUpdateConfig | null) {}

  async getUserWatchingUpdateConfig(): Promise<UserWatchingUpdateConfig | null> {
    return this.config;
  }

  async updateUserWatchingUpdateConfig(): Promise<void> {}

  async clearUserWatchingUpdateConfig(): Promise<void> {}
}

function createService(config: UserWatchingUpdateConfig) {
  let currentNow = 1000;
  const setEnabled = jest.fn().mockResolvedValue({});
  const service = new TriggerLinkAccessControlService(
    new MemoryStore(),
    new MemoryConfigRepository(config),
    { setEnabled },
    () => currentNow,
  );
  return {
    service,
    setEnabled,
    setNow: (next: number) => {
      currentNow = next;
    },
  };
}

const request = {
  tokenId: 'token-1',
  userId: 'alice',
  ip: '203.0.113.1',
  userAgent: 'jest-agent',
};

describe('TriggerLinkAccessControlService', () => {
  it('blocks an IP after the configured access limit', async () => {
    const { service } = createService({
      triggerLinkAccessControl: {
        enabled: true,
        ipLimit: {
          enabled: true,
          windowMinutes: 60,
          maxAttempts: 1,
          blockMinutes: 30,
        },
        userLimit: { enabled: false },
        autoDisable: { enabled: false },
      },
    });

    await expect(service.authorize(request)).resolves.toEqual({
      allowed: true,
    });
    await expect(service.authorize(request)).resolves.toMatchObject({
      allowed: false,
      error: 'ip_rate_limited',
      status: 429,
    });
    await expect(service.authorize(request)).resolves.toMatchObject({
      allowed: false,
      error: 'ip_blocked',
      status: 429,
    });
  });

  it('auto-disables the token after repeated violations in the violation window', async () => {
    const { service, setEnabled } = createService({
      triggerLinkAccessControl: {
        enabled: true,
        ipLimit: {
          enabled: true,
          windowMinutes: 60,
          maxAttempts: 1,
          blockMinutes: 30,
        },
        userLimit: { enabled: false },
        autoDisable: {
          enabled: true,
          violationThreshold: 2,
          violationWindowMinutes: 60,
        },
      },
    });

    await service.authorize(request);
    await service.authorize(request);
    const decision = await service.authorize(request);

    expect(decision).toMatchObject({
      allowed: false,
      error: 'ip_blocked',
      autoDisabled: true,
    });
    expect(setEnabled).toHaveBeenCalledWith('alice', false, {
      disabledReason: 'rate_limit_exceeded',
      disabledAt: 1000,
      disabledSource: 'system',
    });
  });

  it('resets violation counts after the configured violation window', async () => {
    const { service, setEnabled, setNow } = createService({
      triggerLinkAccessControl: {
        enabled: true,
        ipLimit: { enabled: false },
        userLimit: {
          enabled: true,
          windowMinutes: 60,
          maxAttempts: 1,
        },
        autoDisable: {
          enabled: true,
          violationThreshold: 2,
          violationWindowMinutes: 1,
        },
      },
    });

    await service.authorize(request);
    await expect(service.authorize(request)).resolves.toMatchObject({
      allowed: false,
      error: 'user_rate_limited',
      autoDisabled: false,
    });
    setNow(1000 + 61 * 1000);
    await expect(service.authorize(request)).resolves.toMatchObject({
      allowed: false,
      error: 'user_rate_limited',
      autoDisabled: false,
    });

    expect(setEnabled).not.toHaveBeenCalled();
  });
});
