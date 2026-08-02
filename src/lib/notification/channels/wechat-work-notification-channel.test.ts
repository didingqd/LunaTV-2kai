/** @jest-environment node */

import { WeChatWorkNotificationChannel } from './wechat-work-notification-channel';
import type { NotificationMessage } from '../notification-types';

function message(
  overrides: Partial<NotificationMessage> = {},
): NotificationMessage {
  return {
    userId: 'alice',
    type: 'test.event',
    title: 'Demo',
    body: 'Source A 已从 10 集更新到 12 集',
    content: 'Source A 已从 10 集更新到 12 集',
    createdAt: Date.parse('2026-07-30T12:00:00.000Z'),
    payload: {
      source: 'Source A',
      displayTime: '2024-01-01 00:00:00',
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
        type: 'test.failed',
        title: 'Task A',
        body: '资源站异常',
        content: '资源站异常',
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.markdown.content).toContain('Task A');
    expect(body.markdown.content).toContain('资源站异常');
  });

  it('formats watching update messages with WeChat Work markdown hierarchy', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ errcode: 0 }));
    const channel = new WeChatWorkNotificationChannel(
      {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
      fetchMock,
    );

    await channel.send(
      message({
        type: 'watching.update_found',
        title: '更新提醒',
        content:
          '更新提醒\n\n新更新（1）\n\n昭阳公主\n14 → 15 集（+1）\n\n----------------\n\n已更新（3）\n\n才女的侍从 在满是高岭之花的贵族学校暗中照顾（毫无生活自理能力的）学院第一大小姐\n4 → 5 集（+1）\n\n九门\n6 → 8 集（+2）\n\n穹庐下的魔女\n5 → 6 集（+1）',
        payload: {
          displayTime: '2026-08-02 12:30:01',
        },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.markdown.content).toBe(
      '#  更新提醒\n\n## <font color="info">🆕 新更新（1）</font>\n\n• 昭阳公主\n  14 → 15 集（+1）\n\n## <font color="info">✅ 已更新（3）</font>\n\n• 才女的侍从 在满是高岭之花的贵族学校暗中照顾（毫无生活自理能力的）学院第一大小姐\n  4 → 5 集（+1）\n\n• 九门\n  6 → 8 集（+2）\n\n• 穹庐下的魔女\n  5 → 6 集（+1）\n\n<font color="comment"> 2026-08-02 12:30:01</font>',
    );
    expect(body.markdown.content.match(/更新提醒/g)).toHaveLength(1);
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
