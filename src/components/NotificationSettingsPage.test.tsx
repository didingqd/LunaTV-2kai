import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import NotificationSettingsPage from './NotificationSettingsPage';

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

describe('NotificationSettingsPage', () => {
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

  it('loads the two-module notification settings layout with provider-driven cards', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ settings: baseSettings }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    expect(screen.getByText('正在加载通知设置')).toBeInTheDocument();
    expect(await screen.findByText('通知设置')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: '推送总开关' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '添加渠道' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '批量选择' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('系统收件箱')).toBeInTheDocument();
    expect(await screen.findByText('外部企业微信')).toBeInTheDocument();
    expect(screen.getAllByText('事件').length).toBeGreaterThan(0);
    expect(screen.queryByText('追更通知')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '保存' }),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/user/notification-settings', {
      cache: 'no-store',
    });
  });

  it('uses a modal provider step before creating a channel without showing events', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '添加渠道' }));
    expect(await screen.findByText('选择 Provider')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.queryByText('最近测试结果')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('更新检查失败')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('渠道名称'), {
      target: { value: '我的企业微信' },
    });
    fireEvent.change(screen.getByLabelText('Webhook 地址'), {
      target: {
        value: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存渠道' }));

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
    expect(await screen.findByText('通知方式已添加')).toBeInTheDocument();
  });

  it('edits basic provider config in a modal and keeps events on the card', async () => {
    const settingsAfterEdit = {
      ...baseSettings,
      channels: baseSettings.channels.map((channel) =>
        channel.id === 'wc-1' ? { ...channel, name: '企业微信告警' } : channel,
      ),
    };
    const settingsAfterEvents = {
      ...settingsAfterEdit,
      channels: settingsAfterEdit.channels.map((channel) =>
        channel.id === 'wc-1'
          ? {
              ...channel,
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
      .mockResolvedValueOnce(jsonResponse({ settings: settingsAfterEdit }))
      .mockResolvedValueOnce(jsonResponse({ settings: settingsAfterEvents }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    const wechatCard = getCardByChannelName(
      await screen.findByText('外部企业微信').then(() => '外部企业微信'),
    );
    fireEvent.click(wechatCard.getByRole('button', { name: /编辑/ }));
    fireEvent.change(screen.getByLabelText('渠道名称'), {
      target: { value: '企业微信告警' },
    });
    expect(screen.queryByLabelText('更新检查失败')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存渠道' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/user/notification-settings/channels/wc-1',
    );
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      name: '企业微信告警',
    });
    expect(await screen.findByText('通知方式已更新')).toBeInTheDocument();

    const editedCard = getCardByChannelName('企业微信告警');
    fireEvent.click(editedCard.getByLabelText('企业微信告警 更新检查失败'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      subscribedEvents: ['watching.update_found', 'watching.update_failed'],
    });
  });

  it('uses provider capabilities to hide inbox delete and disable inbox creation', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ settings: baseSettings }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    const inboxCard = getCardByChannelName(
      await screen.findByText('系统收件箱').then(() => '系统收件箱'),
    );
    expect(
      inboxCard.queryByRole('button', { name: /删除/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '添加渠道' }));
    const inboxProviderButton = screen.getByRole('button', {
      name: /站内通知/,
    });
    expect(inboxProviderButton).toBeDisabled();
  });

  it('toggles and tests an individual channel card', async () => {
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
    fireEvent.click(wechatCard.getByRole('button', { name: '测试' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/user/notification-settings/test',
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      channelId: 'wc-1',
    });
    expect(await screen.findAllByText('测试通知已发送')).toHaveLength(1);

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

  it('supports batch selection, enabling, disabling and deleting deletable channels', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '批量选择' }));
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByText('已选择：2 个渠道')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '批量禁用' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      enabled: false,
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      enabled: false,
    });

    fireEvent.click(screen.getByRole('button', { name: '批量启用' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      enabled: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({
      enabled: true,
    });

    fireEvent.click(screen.getByRole('button', { name: '批量删除' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(fetchMock.mock.calls[5][0]).toBe(
      '/api/user/notification-settings/channels/wc-1',
    );
    expect(fetchMock.mock.calls[5][1].method).toBe('DELETE');
  });

  it('restores default settings', async () => {
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

  it('shows API errors for administrators', async () => {
    setFetch(
      jest
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'settings failed' }, 500)),
    );

    render(<NotificationSettingsPage />);

    expect(await screen.findByText('settings failed')).toBeInTheDocument();
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
