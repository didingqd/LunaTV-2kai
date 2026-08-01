/** @jest-environment node */

import { WebhookNotificationProvider } from './webhook-notification-provider';

const originalFetch = global.fetch;

describe('WebhookNotificationProvider', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it('posts notification events as JSON', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));
    setFetch(fetchMock);
    const provider = new WebhookNotificationProvider();

    await provider.send(message(), channel());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test': 'yes',
        },
        body: JSON.stringify({
          title: 'Title',
          content: 'Content',
          message: 'Content',
          eventType: 'test.event',
          eventId: 'event-1',
          createdAt: 1_000,
          data: {
            payloadId: 'event-1',
            eventType: 'test.event',
            title: 'Title',
            content: 'Content',
          },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('throws when the webhook request fails', async () => {
    const fetchMock = jest.fn(async () => new Response('', { status: 500 }));
    setFetch(fetchMock);

    await expect(
      new WebhookNotificationProvider().send(message(), channel()),
    ).rejects.toThrow('Webhook notification failed with 500');
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
    id: 'webhook-1',
    type: 'webhook',
    name: 'Webhook',
    enabled: true,
    subscribedEvents: ['test.event'],
    config: {
      url: 'https://example.com/webhook',
      headers: JSON.stringify({ 'X-Test': 'yes' }),
    },
  };
}
