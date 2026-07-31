/** @jest-environment node */

import { NotificationManager } from './notification-manager';
import { NotificationProviderRegistry } from './notification-provider-registry';
import type { NotificationProvider } from './notification-provider';
import type { UserNotificationChannelConfig } from './notification-settings-repository';
import {
  NotificationEventType,
  type NotificationEvent,
} from './notification-types';

function channel(
  overrides: Partial<UserNotificationChannelConfig> = {},
): UserNotificationChannelConfig {
  return {
    id: 'channel-1',
    type: 'fake',
    name: 'Fake provider',
    enabled: true,
    subscribedEvents: [NotificationEventType.WATCHING_UPDATE_FOUND],
    config: {},
    ...overrides,
  };
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: 'event-1',
    type: NotificationEventType.WATCHING_UPDATE_FOUND,
    userId: 'alice',
    data: { title: 'Title' },
    createdAt: 1_000,
    ...overrides,
  };
}

describe('NotificationManager', () => {
  it('sends events through the provider selected by registry type', async () => {
    const send = jest.fn(async () => undefined);
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('fake', send));
    const target = channel();
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [target]),
      },
      registry,
      () => 'generated-event-id',
    );

    await expect(manager.emit(event())).resolves.toEqual({
      success: true,
      totalChannels: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
    });
    expect(send).toHaveBeenCalledWith(event(), target);
  });

  it('reports unsupported providers without hard-coded type branches', async () => {
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [
          channel({ type: 'unknown' }),
        ]),
      },
      new NotificationProviderRegistry(),
    );

    await expect(manager.emit(event())).resolves.toMatchObject({
      success: false,
      totalChannels: 1,
      succeeded: 0,
      failed: 1,
      errors: [
        {
          channel: 'Fake provider',
          message: 'Unsupported notification provider: unknown',
        },
      ],
    });
  });

  it('uses subscribed channels supplied by settings service for each event', async () => {
    const getSubscribedChannelConfigs = jest.fn(async () => []);
    const manager = new NotificationManager(
      { getSubscribedChannelConfigs },
      new NotificationProviderRegistry(),
    );
    const emitted = event({ id: '', data: { nested: 'value' } });

    await manager.emit(emitted);

    expect(getSubscribedChannelConfigs).toHaveBeenCalledWith({
      ...emitted,
      id: expect.any(String),
      data: { nested: 'value' },
    });
  });
});

function createProvider(
  type: string,
  send: NotificationProvider['send'],
): NotificationProvider {
  return {
    type,
    send,
    test: jest.fn(async () => undefined),
    validateConfig: jest.fn(() => ({})),
    getDisplayName: () => type,
    getConfigSchema: () => ({ fields: [] }),
  };
}
