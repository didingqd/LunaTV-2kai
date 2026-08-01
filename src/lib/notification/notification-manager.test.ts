/** @jest-environment node */

import { NotificationManager } from './notification-manager';
import { NotificationProviderRegistry } from './notification-provider-registry';
import type { NotificationProvider } from './notification-provider';
import type { NotificationSendLogEntry } from './notification-log-types';
import type { UserNotificationChannelConfig } from './notification-settings-repository';
import { clearNotificationDedupeStateForTests } from './notification-send-control';
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
  beforeEach(() => {
    clearNotificationDedupeStateForTests();
  });

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
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'alice',
        type: NotificationEventType.WATCHING_UPDATE_FOUND,
        title: 'Title',
        content: '',
        createdAt: 1_000,
        payload: expect.objectContaining({
          payloadId: 'event-1',
          eventType: NotificationEventType.WATCHING_UPDATE_FOUND,
          title: 'Title',
        }),
      }),
      target,
    );
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
      id: expect.any(String),
      type: NotificationEventType.WATCHING_UPDATE_FOUND,
      targetUser: 'alice',
      occurredAt: 1_000,
      data: { nested: 'value' },
    });
  });

  it('sends only channels subscribed to the emitted event type', async () => {
    const foundSend = jest.fn(async () => undefined);
    const failedSend = jest.fn(async () => undefined);
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('found', foundSend));
    registry.register(createProvider('failed', failedSend));
    const channels = [
      channel({
        id: 'found-channel',
        type: 'found',
        name: 'Found channel',
        subscribedEvents: [NotificationEventType.WATCHING_UPDATE_FOUND],
      }),
      channel({
        id: 'failed-channel',
        type: 'failed',
        name: 'Failed channel',
        subscribedEvents: [NotificationEventType.WATCHING_UPDATE_FAILED],
      }),
    ];
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async (emitted) =>
          channels.filter((candidate) =>
            candidate.subscribedEvents.includes(emitted.type),
          ),
        ),
      },
      registry,
    );

    await expect(manager.emit(event())).resolves.toEqual({
      success: true,
      totalChannels: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
    });
    expect(foundSend).toHaveBeenCalledTimes(1);
    expect(failedSend).not.toHaveBeenCalled();
  });

  it('skips preview providers that are not sendable', async () => {
    const send = jest.fn(async () => undefined);
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('preview', send), { canSend: false });
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [
          channel({ type: 'preview' }),
        ]),
      },
      registry,
    );

    await expect(manager.emit(event())).resolves.toEqual({
      success: true,
      totalChannels: 1,
      succeeded: 0,
      failed: 0,
      errors: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('records successful provider sends', async () => {
    const send = jest.fn(async () => undefined);
    const append = jest.fn(
      async (_entry: NotificationSendLogEntry) => undefined,
    );
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('fake', send));
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [channel()]),
      },
      registry,
      () => 'generated-event-id',
      { append },
      { now: () => 2_000 },
    );

    await manager.emit(event());

    expect(append).toHaveBeenCalledWith({
      eventType: NotificationEventType.WATCHING_UPDATE_FOUND,
      channelId: 'channel-1',
      providerType: 'fake',
      status: 'success',
      createdAt: 2_000,
    });
  });

  it('records failed provider sends without exposing secrets', async () => {
    const send = jest.fn(async () => {
      throw new Error(
        'failed https://example.com/webhook?token=secret token=secret',
      );
    });
    const append = jest.fn(
      async (_entry: NotificationSendLogEntry) => undefined,
    );
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('fake', send));
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [channel()]),
      },
      registry,
      () => 'generated-event-id',
      { append },
      { retryDelayMs: 0 },
    );

    const result = await manager.emit(event());

    expect(result.success).toBe(false);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('[redacted-url]'),
      }),
    );
    const failedLog = append.mock.calls[0][0] as NotificationSendLogEntry;
    expect(failedLog.error).not.toContain('secret');
  });

  it('records preview providers as skipped', async () => {
    const send = jest.fn(async () => undefined);
    const append = jest.fn(async () => undefined);
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('preview', send), { canSend: false });
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [
          channel({ type: 'preview' }),
        ]),
      },
      registry,
      () => 'generated-event-id',
      { append },
      { now: () => 2_000 },
    );

    await manager.emit(event());

    expect(send).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith({
      eventType: NotificationEventType.WATCHING_UPDATE_FOUND,
      channelId: 'channel-1',
      providerType: 'preview',
      status: 'skipped',
      createdAt: 2_000,
    });
  });

  it('retries once and succeeds when the second send works', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('fake', send));
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [channel()]),
      },
      registry,
      () => 'generated-event-id',
      { append: jest.fn(async () => undefined) },
      { retryDelayMs: 0 },
    );

    await expect(manager.emit(event())).resolves.toMatchObject({
      success: true,
      succeeded: 1,
      failed: 0,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('records failed after retry attempts are exhausted', async () => {
    const send = jest.fn(async () => {
      throw new Error('permanent failure');
    });
    const append = jest.fn(async () => undefined);
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('fake', send));
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [channel()]),
      },
      registry,
      () => 'generated-event-id',
      { append },
      { retryDelayMs: 0 },
    );

    await expect(manager.emit(event())).resolves.toMatchObject({
      success: false,
      succeeded: 0,
      failed: 1,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'permanent failure',
      }),
    );
  });

  it('fails provider calls that exceed the unified timeout', async () => {
    jest.useFakeTimers();
    const send = jest.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
    );
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('fake', send));
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [channel()]),
      },
      registry,
      () => 'generated-event-id',
      { append: jest.fn(async () => undefined) },
      { retryDelayMs: 0, timeoutMs: 10, maxAttempts: 1 },
    );

    const result = manager.emit(event());
    await jest.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toMatchObject({
      success: false,
      errors: [
        {
          channel: 'Fake provider',
          message: 'Notification provider timed out',
        },
      ],
    });
    jest.useRealTimers();
  });

  it('skips duplicate non-debug events inside the dedupe window', async () => {
    const send = jest.fn(async () => undefined);
    const append = jest.fn(async () => undefined);
    let currentTime = 1_000;
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('fake', send));
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [channel()]),
      },
      registry,
      () => 'generated-event-id',
      { append },
      { now: () => currentTime, dedupeWindowMs: 10_000 },
    );

    await manager.emit(event());
    currentTime = 2_000;
    await manager.emit(event({ id: 'event-2' }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'skipped',
        error: 'Duplicate notification event skipped',
      }),
    );
  });

  it('does not dedupe Run Now debug events', async () => {
    const send = jest.fn(async () => undefined);
    const registry = new NotificationProviderRegistry();
    registry.register(createProvider('fake', send));
    const manager = new NotificationManager(
      {
        getSubscribedChannelConfigs: jest.fn(async () => [channel()]),
      },
      registry,
      () => 'generated-event-id',
      { append: jest.fn(async () => undefined) },
      { now: () => 1_000, dedupeWindowMs: 10_000 },
    );
    const debugEvent = event({
      data: { source: 'notification-debug', metadata: { debug: true } },
    });

    await manager.emit(debugEvent);
    await manager.emit({ ...debugEvent, id: 'event-2' });

    expect(send).toHaveBeenCalledTimes(2);
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
