/** @jest-environment node */

import { registerWatchingUpdateNotificationBuilder } from '@/lib/watching-update-notification-builder';

import { WeChatWorkNotificationProvider } from './wechat-work-notification-provider';

const originalFetch = global.fetch;

describe('WeChatWorkNotificationProvider', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it('uses the watching update template for test messages', async () => {
    const fetchMock = jest.fn(
      async () =>
        new Response(JSON.stringify({ errcode: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    setFetch(fetchMock);

    await new WeChatWorkNotificationProvider().test(channel());

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    const body = JSON.parse(String(requestInit.body));
    expect(body.markdown.content).toBe(
      // 修改点：更新预期为当前渠道输出格式（81cc2b44 简化颜色后的版本），
      // 并包含测试样例新增的资源站名称（括号在剧名后）
      '#  更新提醒\n\n## <font color="info">🆕 新更新（1）</font>\n\n• 测试番剧 A（如意资源）\n  12 → 13 集（+1）\n\n## <font color="info">✅ 已更新（2）</font>\n\n• 测试番剧 B（电影天堂）\n  5 → 6 集（+1）\n\n• 测试番剧 C（极速资源）\n  18 → 20 集（+2）\n\n<font color="comment"> 2026-08-02 12:30:01</font>',
    );
    expect(body.markdown.content).not.toContain('测试通知');
  });

  // 修改点：新增用例 —— 渠道配置自定义内容模板时，测试通知按模板渲染后再发送
  it('renders the channel content template for test messages', async () => {
    // 模板渲染依赖追更事件的变量解析器注册（test() 的消息类型为 watching.update_found）
    registerWatchingUpdateNotificationBuilder();

    const fetchMock = jest.fn(
      async () =>
        new Response(JSON.stringify({ errcode: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    setFetch(fetchMock);

    const customTemplate = [
      '{{title}}',
      '{{#newUpdates}}',
      '',
      '🔥 新番（{{newCount}}）',
      '',
      '{{newUpdates}}',
      '{{/newUpdates}}',
    ].join('\n');
    await new WeChatWorkNotificationProvider().test(
      channel({ contentTemplate: customTemplate }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    const body = JSON.parse(String(requestInit.body));
    // 自定义模板内容无法走企微 markdown 富文本解析，走普通 markdown 回退分支
    expect(body.markdown.content).toBe(
      '### 更新提醒\n更新提醒\n\n🔥 新番（1）\n\n测试番剧 A（如意资源）\n12 → 13 集（+1）\n时间：2026-08-02 12:30:01',
    );
  });
});

function setFetch(fetchMock: jest.Mock) {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
}

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wc-1',
    type: 'wechat_work',
    name: '企业微信',
    enabled: true,
    subscribedEvents: ['watching.update_found'],
    config: {
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      userId: 'alice',
      ...overrides,
    },
  };
}
