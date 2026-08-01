/** @jest-environment node */

import { TelegramNotificationProvider } from './telegram-notification-provider';

const originalFetch = global.fetch;

describe('TelegramNotificationProvider', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it('sends messages through the Bot API', async () => {
    const fetchMock = jest.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    setFetch(fetchMock);

    await new TelegramNotificationProvider().send(message(), channel());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken/sendMessage',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: 'chat-1',
          text: '<b>Title</b>\n\nContent',
          parse_mode: 'HTML',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('throws when Telegram returns an API error', async () => {
    setFetch(
      jest.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: false, description: 'Bad Request' }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );

    await expect(
      new TelegramNotificationProvider().send(message(), channel()),
    ).rejects.toThrow('Bad Request');
  });
});

function setFetch(fetchMock: jest.Mock) {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
}

function message() {
  return {
    userId: 'alice',
    type: 'test.event',
    title: 'Title',
    body: 'Content',
    content: 'Content',
    createdAt: 1_000,
    payload: {
      payloadId: 'event-1',
      eventType: 'test.event',
      title: 'Title',
      content: 'Content',
    },
  };
}

function channel() {
  return {
    id: 'telegram-1',
    type: 'telegram',
    name: 'Telegram',
    enabled: true,
    subscribedEvents: ['test.event'],
    config: {
      token: 'token',
      chatId: 'chat-1',
    },
  };
}
