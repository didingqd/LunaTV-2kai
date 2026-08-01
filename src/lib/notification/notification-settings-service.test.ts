/** @jest-environment node */

jest.mock('@/lib/db', () => ({
  db: {},
}));

import { notificationEventRegistry } from './notification-event-registry';
import {
  NotificationSettingsRepository,
  type NotificationSettingsStore,
} from './notification-settings-repository';
import { NotificationSettingsService } from './notification-settings-service';
import type {
  NotificationMessage,
  NotificationPayload,
} from './notification-types';

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

function message(type = FOUND_EVENT): NotificationMessage {
  return {
    userId: 'alice',
    type,
    title: 'Title',
    content: 'Content',
    createdAt: 1_000,
  };
}

function payload(type = FOUND_EVENT): NotificationPayload {
  return {
    id: 'event-1',
    type,
    targetUser: 'alice',
    data: {},
    occurredAt: 1_000,
  };
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

describe('NotificationSettingsService', () => {
  it('saves partial settings with updatedAt', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository, () => 9_000);

    await expect(
      service.save('alice', {
        subscriptions: [
          { eventType: FAILED_EVENT, enabled: false, channels: [] },
        ],
      }),
    ).resolves.toEqual({
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
      updatedAt: 9_000,
    });
  });

  it('restores defaults', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository);

    await service.save('alice', { inboxEnabled: false });

    await expect(service.restoreDefault('alice')).resolves.toEqual({
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
    });
  });

  it('allows dispatch by default', async () => {
    const service = new NotificationSettingsService(
      new NotificationSettingsRepository(new MemoryNotificationSettingsStore()),
    );

    await expect(service.shouldDispatch(message())).resolves.toBe(true);
  });

  it('keeps channel states unchanged while toggling the notification center', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository, () => 9_000);
    await repository.save('alice', {
      channels: [
        {
          id: 'inbox',
          type: 'inbox',
          name: '站内通知',
          enabled: true,
          subscribedEvents: [FOUND_EVENT],
          config: {},
        },
        {
          id: 'wc-1',
          type: 'wechat_work',
          name: '企业微信',
          enabled: false,
          subscribedEvents: [FOUND_EVENT],
          config: {
            webhookUrl:
              'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
          },
        },
      ],
    });

    const disabled = await service.save('alice', {
      notificationCenterEnabled: false,
    });
    expect(disabled).toMatchObject({
      notificationCenterEnabled: false,
      channels: [
        { id: 'inbox', enabled: true },
        { id: 'wc-1', enabled: false },
      ],
    });
    await expect(
      service.getSubscribedChannelConfigs(payload()),
    ).resolves.toEqual([]);

    await expect(
      service.save('alice', { notificationCenterEnabled: true }),
    ).resolves.toMatchObject({
      notificationCenterEnabled: true,
      channels: [
        { id: 'inbox', enabled: true },
        { id: 'wc-1', enabled: false },
      ],
    });
  });

  it('excludes inbox from enabled channels when inbox is disabled', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository);
    await repository.save('alice', { inboxEnabled: false });

    await expect(service.shouldDispatch(message())).resolves.toBe(false);
    await expect(
      service.getEnabledChannelConfigsForUser('alice'),
    ).resolves.toEqual([]);
  });

  it('blocks events through generic subscriptions', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository);
    await repository.save('alice', {
      subscriptions: [
        { eventType: FOUND_EVENT, enabled: false, channels: [] },
        { eventType: FAILED_EVENT, enabled: false, channels: [] },
      ],
    });

    await expect(service.shouldDispatch(message(FOUND_EVENT))).resolves.toBe(
      false,
    );
    await expect(service.shouldDispatch(message(FAILED_EVENT))).resolves.toBe(
      false,
    );
    await expect(service.shouldDispatch(message('system.test'))).resolves.toBe(
      false,
    );
  });

  it('creates, updates, deletes and masks WeChat Work channels', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository, () => 9_000);

    const created = await service.createChannel('alice', {
      type: 'wechat_work',
      name: '我的企业微信',
      config: {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
    });
    const channel = created.channels.find(
      (item) => item.type === 'wechat_work',
    );
    expect(channel).toMatchObject({
      name: '我的企业微信',
      enabled: true,
      config: {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
    });

    expect(
      service.toPublicSettings(created).channels[1].config.webhookUrl,
    ).toBe('https://qyapi.weixin.qq.com/****abcd');

    const updated = await service.updateChannel('alice', channel!.id, {
      enabled: false,
      config: {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=efgh',
      },
    });
    expect(updated.channels[1]).toMatchObject({
      enabled: false,
      config: {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=efgh',
      },
    });

    await expect(
      service.deleteChannel('alice', channel!.id),
    ).resolves.toMatchObject({
      channels: [{ id: 'inbox', type: 'inbox' }],
    });
  });

  it('returns only enabled channel configs', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository);
    await repository.save('alice', {
      channels: [
        {
          id: 'wc-1',
          type: 'wechat_work',
          name: '企业微信',
          enabled: false,
          config: {
            webhookUrl:
              'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
          },
        },
      ],
    });

    await expect(
      service.getEnabledChannelConfigsForUser('alice'),
    ).resolves.toEqual([
      {
        id: 'inbox',
        type: 'inbox',
        name: '站内通知',
        enabled: true,
        subscribedEvents: [FOUND_EVENT, FAILED_EVENT],
        config: {},
      },
    ]);
  });
});
