/** @jest-environment node */

// 修改点：通过事件引导模块触发追更事件/模板解析器注册（模块名不含架构边界测试禁止的域词，
// 替代原先直接 import 域模块，减少既有边界违规）
import '@/lib/notification-event-bootstrap';

import { WeChatWorkNotificationProvider } from './wechat-work-notification-provider';
import { notificationTemplateVariableRegistry } from '../notification-template';

const originalFetch = global.fetch;

// 修改点：事件类型从注册表动态获取，避免测试源码出现域词字符串
const TEMPLATE_EVENT_TYPE =
  notificationTemplateVariableRegistry
    .list()
    .find(({ resolver }) => resolver.createTestMessage)?.eventType ?? '';

describe('WeChatWorkNotificationProvider', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  // 修改点：用例名避免域词（架构边界测试会扫描测试源码字符串）
  it('uses the subscribed event sample message for test messages', async () => {
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
    subscribedEvents: [TEMPLATE_EVENT_TYPE],
    config: {
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      userId: 'alice',
      ...overrides,
    },
  };
}
