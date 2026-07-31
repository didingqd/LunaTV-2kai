/** @jest-environment node */

jest.mock('@/lib/db', () => ({
  db: {},
}));

import {
  NotificationSettingsRepository,
  type NotificationSettingsStore,
} from './notification-settings-repository';
import { NotificationSettingsService } from './notification-settings-service';
import {
  NotificationEventType,
  NotificationMessageType,
  type NotificationMessage,
  type NotificationMessageType as NotificationMessageTypeValue,
} from './notification-types';

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

function message(
  type: NotificationMessageTypeValue = NotificationMessageType.WATCHING_UPDATE_FOUND,
): NotificationMessage {
  return {
    userId: 'alice',
    type,
    title: 'Title',
    content: 'Content',
    createdAt: 1_000,
  };
}

describe('NotificationSettingsService', () => {
  it('saves partial settings with updatedAt', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository, () => 9_000);

    await expect(
      service.save('alice', { watchingUpdateFailedEnabled: false }),
    ).resolves.toEqual({
      version: 2,
      notificationCenterEnabled: true,
      inboxEnabled: true,
      watchingUpdateFoundEnabled: true,
      watchingUpdateFailedEnabled: false,
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
      watchingUpdateFoundEnabled: true,
      watchingUpdateFailedEnabled: true,
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
      service.getSubscribedChannelConfigs({
        id: 'event-1',
        type: FOUND_EVENT,
        userId: 'alice',
        data: {},
        createdAt: 1_000,
      }),
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

  it('blocks update found and failed by their type switches', async () => {
    const repository = new NotificationSettingsRepository(
      new MemoryNotificationSettingsStore(),
    );
    const service = new NotificationSettingsService(repository);
    await repository.save('alice', {
      watchingUpdateFoundEnabled: false,
      watchingUpdateFailedEnabled: false,
    });

    await expect(
      service.shouldDispatch(
        message(NotificationMessageType.WATCHING_UPDATE_FOUND),
      ),
    ).resolves.toBe(false);
    await expect(
      service.shouldDispatch(
        message(NotificationMessageType.WATCHING_UPDATE_FAILED),
      ),
    ).resolves.toBe(false);
    await expect(
      service.shouldDispatch(message(NotificationMessageType.SYSTEM)),
    ).resolves.toBe(true);
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
