/** @jest-environment node */

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
});

function setFetch(fetchMock: jest.Mock) {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
}

function channel() {
  return {
    id: 'wc-1',
    type: 'wechat_work',
    name: '企业微信',
    enabled: true,
    subscribedEvents: ['watching.update_found'],
    config: {
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      userId: 'alice',
    },
  };
}
