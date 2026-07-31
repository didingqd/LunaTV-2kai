import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import NotificationSettingsPage from './NotificationSettingsPage';
import { getCreatableNotificationProviderMetas } from './notification-settings-provider-ui';

const originalFetch = global.fetch;

const baseSettings = {
  version: 2,
  inboxEnabled: true,
  watchingUpdateFoundEnabled: true,
  watchingUpdateFailedEnabled: true,
  channels: [
    {
      id: 'inbox',
      type: 'inbox',
      name: '系统收件箱',
      enabled: true,
      subscribedEvents: ['watching.update_found', 'watching.update_failed'],
      config: {},
    },
    {
      id: 'wc-1',
      type: 'wechat_work',
      name: '外部企业微信',
      enabled: true,
      subscribedEvents: ['watching.update_found'],
      config: { webhookUrl: 'https://qyapi.weixin.qq.com/****abcd' },
    },
  ],
};

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function setFetch(fetchMock: jest.Mock) {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
}

function setAuth(role: 'owner' | 'admin' | 'user' = 'admin') {
  document.cookie = `user_auth=${encodeURIComponent(
    JSON.stringify({ username: 'tester', role }),
  )}`;
}

function clearAuth() {
  document.cookie = 'user_auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
}

function getCardByChannelName(name: string) {
  const title = screen.getByText(name);
  const card = title.closest('article');
  if (!card) throw new Error(`card not found: ${name}`);
  return within(card);
}

describe('NotificationSettingsPage Stage 2.7 UI', () => {
  beforeEach(() => {
    setAuth('admin');
  });

  afterEach(() => {
    clearAuth();
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
    jest.restoreAllMocks();
  });

  it('renders two modules and keeps channel cards as summary-only rows', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ settings: baseSettings }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    expect(screen.getAllByText('正在加载通知设置').length).toBeGreaterThan(0);
    expect(await screen.findByText('外部企业微信')).toBeInTheDocument();
    expect(screen.getByText('通知配置')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '通知渠道' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: '推送总开关' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '添加通知渠道' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '批量管理' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '恢复默认' }),
    ).toBeInTheDocument();

    const wechatCard = getCardByChannelName('外部企业微信');
    expect(wechatCard.getByText('企业微信')).toBeInTheDocument();
    expect(wechatCard.getByText('启用')).toBeInTheDocument();
    expect(
      wechatCard.getByRole('switch', { name: '启停 外部企业微信' }),
    ).toBeInTheDocument();
    expect(
      wechatCard.getByRole('button', { name: /测试/ }),
    ).toBeInTheDocument();
    expect(
      wechatCard.getByRole('button', { name: /编辑/ }),
    ).toBeInTheDocument();
    expect(
      wechatCard.getByRole('button', { name: /删除/ }),
    ).toBeInTheDocument();

    expect(wechatCard.queryByText('wechat_work')).not.toBeInTheDocument();
    expect(
      wechatCard.queryByText('发送通知到企业微信群机器人。'),
    ).not.toBeInTheDocument();
    expect(
      wechatCard.queryByText('watching.update_found'),
    ).not.toBeInTheDocument();
    expect(wechatCard.queryByText('Webhook 地址')).not.toBeInTheDocument();
    expect(
      wechatCard.queryByText('https://qyapi.weixin.qq.com/****abcd'),
    ).not.toBeInTheDocument();
    expect(wechatCard.queryByText(/最近测试/)).not.toBeInTheDocument();
    expect(screen.queryByText('追更更新')).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith('/api/user/notification-settings', {
      cache: 'no-store',
    });
  });

  it('opens the RenewHelper-style provider picker and enters create config by clicking a provider card', async () => {
    const settingsAfterCreate = {
      ...baseSettings,
      channels: [
        baseSettings.channels[0],
        {
          id: 'wc-new',
          type: 'wechat_work',
          name: '我的企业微信',
          enabled: true,
          subscribedEvents: ['watching.update_found', 'watching.update_failed'],
          config: { webhookUrl: 'https://qyapi.weixin.qq.com/****abcd' },
        },
      ],
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { ...baseSettings, channels: [baseSettings.channels[0]] },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ settings: settingsAfterCreate }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: '添加通知渠道' }),
    );
    expect(
      await screen.findByRole('heading', { name: '选择通知渠道' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '下一步' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('Bark')).toBeInTheDocument();
    expect(screen.getByText('钉钉')).toBeInTheDocument();
    expect(screen.getByText('飞书')).toBeInTheDocument();
    expect(screen.getByText('Server酱3')).toBeInTheDocument();
    expect(screen.getByText('Ntfy')).toBeInTheDocument();

    fireEvent.click(screen.getByText('企业微信').closest('button')!);
    expect(
      await screen.findByRole('heading', { name: '配置通知渠道' }),
    ).toBeInTheDocument();
    expect(screen.getByText('基础信息')).toBeInTheDocument();
    expect(screen.getByText('Provider配置')).toBeInTheDocument();
    expect(screen.queryByText('通知事件')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('渠道名称'), {
      target: { value: '我的企业微信' },
    });
    fireEvent.change(screen.getByLabelText(/Webhook 地址/), {
      target: {
        value: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/user/notification-settings/channels',
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      type: 'wechat_work',
      name: '我的企业微信',
      subscribedEvents: ['watching.update_found', 'watching.update_failed'],
      config: {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
    });
    expect(await screen.findByText('通知渠道已添加')).toBeInTheDocument();
  });

  it('edits provider config and event subscriptions in a modal instead of on the card', async () => {
    const settingsAfterEdit = {
      ...baseSettings,
      channels: baseSettings.channels.map((channel) =>
        channel.id === 'wc-1'
          ? {
              ...channel,
              name: '企业微信告警',
              subscribedEvents: [
                'watching.update_found',
                'watching.update_failed',
              ],
            }
          : channel,
      ),
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ settings: baseSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: settingsAfterEdit }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    const wechatCard = getCardByChannelName(
      await screen.findByText('外部企业微信').then(() => '外部企业微信'),
    );
    fireEvent.click(wechatCard.getByRole('button', { name: /编辑/ }));

    expect(
      await screen.findByRole('heading', { name: '编辑通知渠道' }),
    ).toBeInTheDocument();
    expect(screen.getByText('基础信息')).toBeInTheDocument();
    expect(screen.getByText('Provider配置')).toBeInTheDocument();
    expect(screen.getByText('通知事件')).toBeInTheDocument();
    expect(screen.getByText('watching.update_found')).toBeInTheDocument();
    expect(screen.getByText('scheduler.failed')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('渠道名称'), {
      target: { value: '企业微信告警' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '更新失败' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/user/notification-settings/channels/wc-1',
    );
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      name: '企业微信告警',
      subscribedEvents: ['watching.update_found', 'watching.update_failed'],
    });
    expect(await screen.findByText('通知渠道已更新')).toBeInTheDocument();
    expect(
      getCardByChannelName('企业微信告警').queryByText('通知事件'),
    ).not.toBeInTheDocument();
  });

  it('toggles and tests an individual channel without showing recent test details on the card', async () => {
    const settingsAfterToggle = {
      ...baseSettings,
      channels: baseSettings.channels.map((channel) =>
        channel.id === 'wc-1' ? { ...channel, enabled: false } : channel,
      ),
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ settings: baseSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: baseSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: settingsAfterToggle }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    const wechatCard = getCardByChannelName(
      await screen.findByText('外部企业微信').then(() => '外部企业微信'),
    );
    fireEvent.click(wechatCard.getByRole('button', { name: /测试/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/user/notification-settings/test',
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      channelId: 'wc-1',
    });
    expect(await screen.findAllByText('测试通知已发送')).toHaveLength(1);
    expect(wechatCard.queryByText(/最近测试/)).not.toBeInTheDocument();

    fireEvent.click(
      wechatCard.getByRole('switch', { name: '启停 外部企业微信' }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe(
      '/api/user/notification-settings/channels/wc-1',
    );
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      enabled: false,
    });
  });

  it('supports batch selection, select all, enable, close and delete while skipping non-deletable channels', async () => {
    const afterDisableInbox = {
      ...baseSettings,
      channels: baseSettings.channels.map((channel) =>
        channel.id === 'inbox' ? { ...channel, enabled: false } : channel,
      ),
    };
    const afterDisableAll = {
      ...afterDisableInbox,
      channels: afterDisableInbox.channels.map((channel) =>
        channel.id === 'wc-1' ? { ...channel, enabled: false } : channel,
      ),
    };
    const afterEnableInbox = {
      ...afterDisableAll,
      channels: afterDisableAll.channels.map((channel) =>
        channel.id === 'inbox' ? { ...channel, enabled: true } : channel,
      ),
    };
    const afterEnableAll = {
      ...afterEnableInbox,
      channels: afterEnableInbox.channels.map((channel) =>
        channel.id === 'wc-1' ? { ...channel, enabled: true } : channel,
      ),
    };
    const afterDelete = {
      ...afterEnableAll,
      channels: afterEnableAll.channels.filter(
        (channel) => channel.id !== 'wc-1',
      ),
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ settings: baseSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: afterDisableInbox }))
      .mockResolvedValueOnce(jsonResponse({ settings: afterDisableAll }))
      .mockResolvedValueOnce(jsonResponse({ settings: afterEnableInbox }))
      .mockResolvedValueOnce(jsonResponse({ settings: afterEnableAll }))
      .mockResolvedValueOnce(jsonResponse({ settings: afterDelete }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '批量管理' }));
    expect(screen.getByText('已选择 0 项')).toBeInTheDocument();
    expect(screen.getByLabelText('选择 系统收件箱')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByText('已选择 2 项')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      enabled: false,
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      enabled: false,
    });

    fireEvent.click(screen.getByRole('button', { name: '启用' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      enabled: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({
      enabled: true,
    });

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(fetchMock.mock.calls[5][0]).toBe(
      '/api/user/notification-settings/channels/wc-1',
    );
    expect(fetchMock.mock.calls[5][1].method).toBe('DELETE');
  });

  it('keeps the page provider-driven for future provider additions', async () => {
    const creatableTypes = getCreatableNotificationProviderMetas().map(
      (provider) => provider.type,
    );
    expect(creatableTypes).toEqual(
      expect.arrayContaining([
        'telegram',
        'bark',
        'pushplus',
        'dingtalk',
        'lark',
        'wecom',
        'serverchan3',
        'notifyx',
        'resend',
        'webhook',
        'gotify',
        'ntfy',
      ]),
    );
  });

  it('restores default settings and shows API/admin states', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ settings: baseSettings }))
      .mockResolvedValueOnce(jsonResponse({ settings: baseSettings }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '恢复默认' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
    expect(await screen.findByText('已恢复默认通知设置')).toBeInTheDocument();
  });

  it('hides settings UI from normal users before loading management APIs', async () => {
    setAuth('user');
    const fetchMock = jest.fn();
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    expect(await screen.findByText(/通知设置仅管理员可见/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
