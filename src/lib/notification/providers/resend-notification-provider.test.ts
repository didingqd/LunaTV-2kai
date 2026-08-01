/** @jest-environment node */

import { ResendNotificationProvider } from './resend-notification-provider';

const originalFetch = global.fetch;

describe('ResendNotificationProvider', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it('sends email through the Resend API', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));
    setFetch(fetchMock);

    await new ResendNotificationProvider().send(message(), channel());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer re_key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'noreply@example.com',
          to: ['alice@example.com', 'bob@example.com'],
          subject: 'Title',
          text: 'Content',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('throws when Resend returns an API error', async () => {
    setFetch(
      jest.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Invalid API key' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(
      new ResendNotificationProvider().send(message(), channel()),
    ).rejects.toThrow('Invalid API key');
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
    type: 'watching.update_found',
    title: 'Title',
    body: 'Content',
    content: 'Content',
    createdAt: 1_000,
    payload: {
      payloadId: 'event-1',
      eventType: 'watching.update_found',
      title: 'Title',
      content: 'Content',
    },
  };
}

function channel() {
  return {
    id: 'resend-1',
    type: 'resend',
    name: 'Email',
    enabled: true,
    subscribedEvents: ['watching.update_found'],
    config: {
      apiKey: 're_key',
      from: 'noreply@example.com',
      to: 'alice@example.com, bob@example.com',
    },
  };
}
