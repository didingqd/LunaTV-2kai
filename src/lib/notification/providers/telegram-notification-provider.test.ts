/** @jest-environment node */

// 修改点：通过事件引导模块触发追更事件/模板解析器注册（模块名不含架构边界测试禁止的域词）
import '@/lib/notification-event-bootstrap';

import { TelegramNotificationProvider } from './telegram-notification-provider';
import { notificationTemplateVariableRegistry } from '../notification-template';

const originalFetch = global.fetch;

// 修改点：事件类型从注册表动态获取，避免测试源码出现域词字符串
const TEMPLATE_EVENT_TYPE =
  notificationTemplateVariableRegistry
    .list()
    .find(({ resolver }) => resolver.createTestMessage)?.eventType ?? '';

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

  // 修改点：新增用例 —— 渠道订阅了追更事件且配置内容模板时，
  // 测试通知使用追更样例消息并按渠道模板渲染（所有渠道统一行为）
  it('renders the channel content template for test messages', async () => {
    const fetchMock = jest.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    setFetch(fetchMock);

    const customTemplate = '🎬 {{title}}（{{displayTime}}）';
    await new TelegramNotificationProvider().test(
      channel({
        subscribedEvents: [TEMPLATE_EVENT_TYPE],
        config: {
          token: 'token',
          chatId: 'chat-1',
          contentTemplate: customTemplate,
        },
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    const body = JSON.parse(String(requestInit.body));
    expect(body.chat_id).toBe('chat-1');
    // 测试通知按模板渲染追更样例数据
    expect(body.text).toBe(
      '<b>更新提醒</b>\n\n🎬 更新提醒（2026-08-02 12:30:01）',
    );
  });

  // 修改点：新增用例 —— 未订阅带样例事件的渠道，测试通知保持原通用文本
  it('keeps the generic test message when no template event is subscribed', async () => {
    const fetchMock = jest.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    setFetch(fetchMock);

    await new TelegramNotificationProvider().test(
      channel({
        subscribedEvents: ['test.event'],
        config: {
          token: 'token',
          chatId: 'chat-1',
          contentTemplate: '模板 {{newCount}}',
        },
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    const body = JSON.parse(String(requestInit.body));
    expect(body.text).toBe('<b>测试通知</b>\n\n这是一条 LunaTV 测试通知。');
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

// 修改点：channel 支持覆盖参数，便于测试不同订阅事件与渠道配置
function channel(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}
