/** @jest-environment node */

import { WeChatWorkNotificationChannel } from './wechat-work-notification-channel';
import type { NotificationMessage } from '../notification-types';

function message(
  overrides: Partial<NotificationMessage> = {},
): NotificationMessage {
  return {
    userId: 'alice',
    type: 'watching.update_found',
    title: 'Demo',
    body: 'Source A 已从 10 集更新到 12 集',
    content: 'Source A 已从 10 集更新到 12 集',
    createdAt: Date.parse('2026-07-30T12:00:00.000Z'),
    payload: {
      source: 'Source A',
      episode: '第12集',
    },
    ...overrides,
  };
}

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('WeChatWorkNotificationChannel', () => {
  it('sends markdown messages to the configured webhook', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ errcode: 0 }));
    const channel = new WeChatWorkNotificationChannel(
      {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
      fetchMock,
    );

    await channel.send(message());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.content).toContain('Demo');
    expect(body.markdown.content).toContain('Source A 已从 10 集更新到 12 集');
  });

  it('sends failed messages without business-specific formatting', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ errcode: 0 }));
    const channel = new WeChatWorkNotificationChannel(
      {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
      fetchMock,
    );

    await channel.send(
      message({
        type: 'watching.update_failed',
        title: 'Task A',
        body: '资源站异常',
        content: '资源站异常',
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.markdown.content).toContain('Task A');
    expect(body.markdown.content).toContain('资源站异常');
  });

  it('throws when webhook request fails', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({}, false, 500));
    const channel = new WeChatWorkNotificationChannel(
      {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
      fetchMock,
    );

    await expect(channel.send(message())).rejects.toThrow(
      'WeChat Work webhook failed with 500',
    );
  });

  it('throws when webhook URL is missing', async () => {
    const channel = new WeChatWorkNotificationChannel({}, jest.fn());

    await expect(channel.send(message())).rejects.toThrow(
      'WeChat Work webhook URL is required',
    );
  });
});
