/** @jest-environment node */

jest.mock('@/lib/db', () => ({
  db: {},
}));

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettingsRepository,
  type NotificationSettingsStore,
} from './notification-settings-repository';
import { NotificationEventType } from './notification-types';

const FOUND_EVENT = NotificationEventType.WATCHING_UPDATE_FOUND;
const FAILED_EVENT = NotificationEventType.WATCHING_UPDATE_FAILED;

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

describe('NotificationSettingsRepository', () => {
  it('returns default settings for old users without stored settings', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );

    await expect(repository.getForUser('alice')).resolves.toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
  });

  it('saves settings under a per-user key', async () => {
    const store = new MemoryNotificationSettingsStore();
    const repository = new NotificationSettingsRepository(store);

    await repository.save('alice', {
      version: 2,
      inboxEnabled: false,
      watchingUpdateFoundEnabled: true,
      watchingUpdateFailedEnabled: false,
      updatedAt: 1_000,
    });
    await repository.save('bob', {
      version: 2,
      inboxEnabled: true,
      watchingUpdateFoundEnabled: false,
      watchingUpdateFailedEnabled: true,
      updatedAt: 2_000,
    });

    await expect(repository.getForUser('alice')).resolves.toEqual({
      version: 2,
      inboxEnabled: false,
      watchingUpdateFoundEnabled: true,
      watchingUpdateFailedEnabled: false,
      channels: [
        {
          id: 'inbox',
          type: 'inbox',
          name: '站内通知',
          enabled: false,
          subscribedEvents: [FOUND_EVENT],
          config: {},
        },
      ],
      updatedAt: 1_000,
    });
    await expect(repository.getForUser('bob')).resolves.toEqual({
      version: 2,
      inboxEnabled: true,
      watchingUpdateFoundEnabled: false,
      watchingUpdateFailedEnabled: true,
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
        watchingUpdateFoundEnabled: false,
        watchingUpdateFailedEnabled: null,
        updatedAt: 123,
      }),
    ).toEqual({
      version: 2,
      inboxEnabled: true,
      watchingUpdateFoundEnabled: false,
      watchingUpdateFailedEnabled: true,
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
      DEFAULT_NOTIFICATION_SETTINGS,
    );
  });

  it('deletes settings and falls back to defaults', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );

    await repository.save('alice', {
      inboxEnabled: false,
      watchingUpdateFoundEnabled: false,
      watchingUpdateFailedEnabled: false,
    });
    await repository.delete('alice');

    await expect(repository.getForUser('alice')).resolves.toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
  });
});
