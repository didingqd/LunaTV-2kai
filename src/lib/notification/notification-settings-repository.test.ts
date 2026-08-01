/** @jest-environment node */

jest.mock('@/lib/db', () => ({
  db: {},
}));

import { notificationEventRegistry } from './notification-event-registry';
import {
  NotificationSettingsRepository,
  getDefaultNotificationSettings,
  type NotificationSettingsStore,
  type UserNotificationSettings,
} from './notification-settings-repository';

const FOUND_EVENT = 'test.event';
const FAILED_EVENT = 'test.failed';

class MemoryNotificationSettingsStore implements NotificationSettingsStore {
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

beforeEach(() => {
  notificationEventRegistry.clearForTests();
  notificationEventRegistry.registerMany([
    {
      type: FOUND_EVENT,
      label: 'Test found',
      description: 'Test found event.',
      defaultSubscribed: true,
    },
    {
      type: FAILED_EVENT,
      label: 'Test failed',
      description: 'Test failed event.',
      defaultSubscribed: true,
    },
  ]);
});

describe('NotificationSettingsRepository', () => {
  it('returns default settings for old users without stored settings', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );

    await expect(repository.getForUser('alice')).resolves.toEqual(
      getDefaultNotificationSettings(),
    );
  });

  it('saves settings under a per-user key', async () => {
    const store = new MemoryNotificationSettingsStore();
    const repository = new NotificationSettingsRepository(store);

    await repository.save('alice', {
      version: 2,
      notificationCenterEnabled: true,
      inboxEnabled: true,
      subscriptions: [
        { eventType: FAILED_EVENT, enabled: false, channels: [] },
      ],
      updatedAt: 1_000,
    });
    await repository.save('bob', {
      version: 2,
      notificationCenterEnabled: true,
      inboxEnabled: true,
      subscriptions: [{ eventType: FOUND_EVENT, enabled: false, channels: [] }],
      updatedAt: 2_000,
    });

    await expect(repository.getForUser('alice')).resolves.toEqual({
      version: 2,
      notificationCenterEnabled: true,
      inboxEnabled: true,
      subscriptions: [
        { eventType: FOUND_EVENT, enabled: true, channels: ['inbox'] },
      ],
      channels: [
        {
          id: 'inbox',
          type: 'inbox',
          name: '站内通知',
          enabled: true,
          subscribedEvents: [FOUND_EVENT],
          config: {},
        },
      ],
      updatedAt: 1_000,
    });
    await expect(repository.getForUser('bob')).resolves.toEqual({
      version: 2,
      notificationCenterEnabled: true,
      inboxEnabled: true,
      subscriptions: [
        { eventType: FAILED_EVENT, enabled: true, channels: ['inbox'] },
      ],
      channels: [
        {
          id: 'inbox',
          type: 'inbox',
          name: '站内通知',
          enabled: true,
          subscribedEvents: [FAILED_EVENT],
          config: {},
        },
      ],
      updatedAt: 2_000,
    });
  });

  it('normalizes missing and invalid values to defaults', () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );

    expect(
      repository.normalize({
        inboxEnabled: 'no',
        updatedAt: 123,
      }),
    ).toEqual({
      version: 2,
      notificationCenterEnabled: true,
      inboxEnabled: true,
      subscriptions: [
        { eventType: FOUND_EVENT, enabled: true, channels: ['inbox'] },
        { eventType: FAILED_EVENT, enabled: true, channels: ['inbox'] },
      ],
      channels: [
        {
          id: 'inbox',
          type: 'inbox',
          name: '站内通知',
          enabled: true,
          subscribedEvents: [FOUND_EVENT, FAILED_EVENT],
          config: {},
        },
      ],
      updatedAt: 123,
    });
  });

  it('normalizes custom channels and keeps users isolated', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );

    await repository.save('alice', {
      channels: [
        {
          id: 'wc-1',
          type: 'wechat_work',
          name: '企业微信',
          enabled: true,
          config: {
            webhookUrl:
              'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
          },
        },
      ],
    });

    await expect(repository.getForUser('alice')).resolves.toMatchObject({
      channels: [
        { id: 'inbox', type: 'inbox' },
        { id: 'wc-1', type: 'wechat_work', name: '企业微信' },
      ],
    });
    await expect(repository.getForUser('bob')).resolves.toEqual(
      getDefaultNotificationSettings(),
    );
  });

  it('migrates legacy settings through registered compatibility readers', () => {
    notificationEventRegistry.registerLegacySubscriptionReader((settings) => [
      {
        eventType: FOUND_EVENT,
        enabled: settings.legacyFoundEnabled === true,
      },
      {
        eventType: FAILED_EVENT,
        enabled: settings.legacyFailedEnabled === true,
      },
    ]);
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );

    expect(
      repository.normalize({
        legacyFoundEnabled: false,
        legacyFailedEnabled: true,
      } as unknown as UserNotificationSettings),
    ).toMatchObject({
      channels: [
        {
          id: 'inbox',
          subscribedEvents: [FAILED_EVENT],
        },
      ],
      subscriptions: [
        { eventType: FAILED_EVENT, enabled: true, channels: ['inbox'] },
      ],
    });
  });

  it('deletes settings and falls back to defaults', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );

    await repository.save('alice', { inboxEnabled: false });
    await repository.delete('alice');

    await expect(repository.getForUser('alice')).resolves.toEqual(
      getDefaultNotificationSettings(),
    );
  });
});
