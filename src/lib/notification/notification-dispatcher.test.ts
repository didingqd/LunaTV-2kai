/** @jest-environment node */

import type { NotificationChannel } from './notification-channel';
import { NotificationDispatcher } from './notification-dispatcher';
import type { NotificationMessage } from './notification-types';

function createMessage(
  overrides: Partial<NotificationMessage> = {},
): NotificationMessage {
  return {
    userId: 'alice',
    type: 'watching-update',
    title: 'New episode',
    content: 'Episode 10 is available.',
    createdAt: 1_000,
    payload: {
      mediaId: 'media-1',
    },
    ...overrides,
  };
}

function createChannel(
  name: string,
  send: NotificationChannel['send'],
): NotificationChannel {
  return {
    name,
    send,
  };
}

describe('NotificationDispatcher', () => {
  it('registers channels and lists them in registration order', () => {
    const dispatcher = new NotificationDispatcher();
    const inbox = createChannel('inbox', jest.fn());
    const email = createChannel('email', jest.fn());

    dispatcher.register(inbox);
    dispatcher.register(email);

    expect(dispatcher.getChannels()).toEqual([inbox, email]);
  });

  it('unregisters a channel by name', () => {
    const dispatcher = new NotificationDispatcher();
    const inbox = createChannel('inbox', jest.fn());
    const email = createChannel('email', jest.fn());

    dispatcher.register(inbox);
    dispatcher.register(email);
    dispatcher.unregister('inbox');

    expect(dispatcher.getChannels()).toEqual([email]);
  });

  it('dispatches to multiple channels sequentially', async () => {
    const dispatcher = new NotificationDispatcher();
    const calls: string[] = [];

    dispatcher.register(
      createChannel('inbox', async () => {
        calls.push('inbox:start');
        await Promise.resolve();
        calls.push('inbox:end');
      }),
    );
    dispatcher.register(
      createChannel('email', async () => {
        calls.push('email:start');
        calls.push('email:end');
      }),
    );

    const result = await dispatcher.dispatch(createMessage());

    expect(calls).toEqual([
      'inbox:start',
      'inbox:end',
      'email:start',
      'email:end',
    ]);
    expect(result).toEqual({
      success: true,
      totalChannels: 2,
      succeeded: 2,
      failed: 0,
      errors: [],
    });
  });

  it('continues dispatching after a channel throws', async () => {
    const dispatcher = new NotificationDispatcher();
    const sendAfterFailure = jest.fn(async () => undefined);

    dispatcher.register(
      createChannel('inbox', async () => {
        throw new Error('inbox failed');
      }),
    );
    dispatcher.register(createChannel('email', sendAfterFailure));

    const result = await dispatcher.dispatch(createMessage());

    expect(sendAfterFailure).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: false,
      totalChannels: 2,
      succeeded: 1,
      failed: 1,
      errors: [
        {
          channel: 'inbox',
          message: 'inbox failed',
        },
      ],
    });
  });

  it('returns a fallback error message for non-Error throws', async () => {
    const dispatcher = new NotificationDispatcher();

    dispatcher.register(
      createChannel('webhook', async () => {
        throw 'failed';
      }),
    );

    await expect(dispatcher.dispatch(createMessage())).resolves.toEqual({
      success: false,
      totalChannels: 1,
      succeeded: 0,
      failed: 1,
      errors: [
        {
          channel: 'webhook',
          message: 'Unknown notification dispatch error',
        },
      ],
    });
  });

  it('returns a successful empty result when no channels are registered', async () => {
    const dispatcher = new NotificationDispatcher();

    await expect(dispatcher.dispatch(createMessage())).resolves.toEqual({
      success: true,
      totalChannels: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    });
  });

  it('passes the original message object to each channel unchanged', async () => {
    const dispatcher = new NotificationDispatcher();
    const message = createMessage();
    const firstSend = jest.fn<ReturnType<NotificationChannel['send']>, Parameters<NotificationChannel['send']>>(
      async () => undefined,
    );
    const secondSend = jest.fn<
      ReturnType<NotificationChannel['send']>,
      Parameters<NotificationChannel['send']>
    >(async () => undefined);

    dispatcher.register(createChannel('inbox', firstSend));
    dispatcher.register(createChannel('email', secondSend));

    await dispatcher.dispatch(message);

    expect(firstSend).toHaveBeenCalledWith(message);
    expect(secondSend).toHaveBeenCalledWith(message);
    expect(firstSend.mock.calls[0][0]).toBe(message);
    expect(secondSend.mock.calls[0][0]).toBe(message);
  });
});
