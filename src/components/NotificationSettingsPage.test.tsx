import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import NotificationSettingsPage from './NotificationSettingsPage';

const originalFetch = global.fetch;
const settingsEndpoint = '/api/user/notification-settings';
const providersEndpoint = '/api/user/notification-providers';
const runNowEndpoint = '/api/user/notification-settings/run-now';
const logsEndpoint = '/api/admin/notification-logs';

const baseSettings = {
  version: 2,
  notificationCenterEnabled: true,
  inboxEnabled: true,
  subscriptions: [
    {
      eventType: 'watching.update_found',
      enabled: true,
      channels: ['inbox', 'wc-1'],
    },
    {
      eventType: 'watching.update_failed',
      enabled: true,
      channels: ['inbox'],
    },
  ],
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
      enabled: false,
      subscribedEvents: ['watching.update_found'],
      config: { webhookUrl: 'https://qyapi.weixin.qq.com/****abcd' },
    },
  ],
};

const providers = [
  {
    type: 'inbox',
    displayName: '站内通知',
    description: '在 LunaTV 站内通知中心接收消息。',
    icon: 'inbox',
    group: '官方',
    sortOrder: 10,
    configSchema: { fields: [] },
    capabilities: {
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canTest: false,
      canToggle: true,
      canSend: true,
    },
    deliveryStatus: 'active',
  },
  {
    type: 'wechat_work',
    displayName: '企业微信',
    description: '发送通知到企业微信群机器人。',
    icon: 'building-2',
    group: '官方',
    sortOrder: 20,
    configSchema: {
      fields: [
        {
          key: 'webhookUrl',
          type: 'url',
          label: 'Webhook 地址',
          required: true,
        },
      ],
    },
    capabilities: {
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canTest: true,
      canToggle: true,
      canSend: true,
    },
    deliveryStatus: 'active',
  },
];

const providersWithMergedEnterpriseWechat = [
  ...providers,
  {
    type: 'wecom',
    displayName: '企业微信机器人',
    description: '企业微信机器人 Key 推送。',
    icon: 'building-2',
    group: '企业消息',
    sortOrder: 230,
    configSchema: {
      fields: [
        {
          key: 'token',
          type: 'password',
          label: '机器人 Key',
          required: true,
        },
      ],
    },
    capabilities: {
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canTest: true,
      canToggle: true,
      canSend: false,
    },
    deliveryStatus: 'preview',
  },
];

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
  });

  it('renders enabled notification-center controls and configured channels', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      if (String(input) === providersEndpoint) {
        return Promise.resolve(jsonResponse({ providers }));
      }
      return Promise.resolve(jsonResponse({ settings: baseSettings }));
    });
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    expect(await screen.findByText('外部企业微信')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '推送总开关' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.getByRole('button', { name: '添加通知渠道' }),
    ).toBeInTheDocument();
    expect(
      getCardByChannelName('外部企业微信').getByRole('switch', {
        name: '启停 外部企业微信',
      }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(fetchMock).toHaveBeenCalledWith(settingsEndpoint, {
      cache: 'no-store',
    });
    expect(fetchMock).toHaveBeenCalledWith(providersEndpoint, {
      cache: 'no-store',
    });
  });

  it('updates only the total switch and restores stored channel states after re-enabling', async () => {
    const disabledSettings = {
      ...baseSettings,
      notificationCenterEnabled: false,
    };
    const patchResponses = [disabledSettings, baseSettings];
    let patchCount = 0;
    const fetchMock = jest.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === providersEndpoint) {
          return Promise.resolve(jsonResponse({ providers }));
        }
        if (url === settingsEndpoint && init?.method === 'PATCH') {
          return Promise.resolve(
            jsonResponse({ settings: patchResponses[patchCount++] }),
          );
        }
        return Promise.resolve(jsonResponse({ settings: baseSettings }));
      },
    );
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(await screen.findByRole('switch', { name: '推送总开关' }));

    await waitFor(() =>
      expect(screen.getByText('通知中心已关闭')).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('heading', { name: '通知渠道' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '添加通知渠道' }),
    ).not.toBeInTheDocument();

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === settingsEndpoint &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    expect(
      JSON.parse((patchCalls[0][1] as RequestInit).body as string),
    ).toEqual({
      notificationCenterEnabled: false,
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith(`${settingsEndpoint}/channels/`),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('switch', { name: '推送总开关' }));

    await waitFor(() =>
      expect(screen.getByText('通知中心已启用')).toBeInTheDocument(),
    );
    expect(await screen.findByText('外部企业微信')).toBeInTheDocument();
    expect(
      getCardByChannelName('外部企业微信').getByRole('switch', {
        name: '启停 外部企业微信',
      }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(patchCalls).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === settingsEndpoint &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toHaveLength(2);
  });

  it('does not load notification settings for normal users', async () => {
    setAuth('user');
    const fetchMock = jest.fn();
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    expect(
      await screen.findByText('通知设置仅管理员可见。'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens run-now event picker and submits a debug event', async () => {
    const fetchMock = jest.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === providersEndpoint) {
          return Promise.resolve(jsonResponse({ providers }));
        }
        if (url === runNowEndpoint && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              eventType: 'notification.test',
              success: true,
              totalChannels: 1,
              succeeded: 1,
              failed: 0,
              errors: [],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ settings: baseSettings }));
      },
    );
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: '立即测试通知' }),
    );
    expect(
      screen.getByRole('heading', { name: '立即测试通知' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '执行测试' }));

    await waitFor(() =>
      expect(screen.getByText('✓ 已发送')).toBeInTheDocument(),
    );
    expect(screen.getByText('事件类型：notification.test')).toBeInTheDocument();
    expect(screen.getByText('匹配渠道数量：1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(runNowEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'notification.test' }),
    });
  });

  it('renders provider picker as a flat list with one enterprise WeChat entry', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      if (String(input) === providersEndpoint) {
        return Promise.resolve(
          jsonResponse({ providers: providersWithMergedEnterpriseWechat }),
        );
      }
      return Promise.resolve(jsonResponse({ settings: baseSettings }));
    });
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: '添加通知渠道' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: '选择通知渠道',
    });
    const picker = within(dialog);

    expect(
      picker.queryByRole('heading', { name: '官方' }),
    ).not.toBeInTheDocument();
    expect(
      picker.queryByRole('heading', { name: '企业消息' }),
    ).not.toBeInTheDocument();
    expect(picker.queryByText('企业微信机器人')).not.toBeInTheDocument();
    expect(picker.getAllByRole('button', { name: /企业微信/ })).toHaveLength(1);

    fireEvent.click(picker.getByRole('button', { name: /企业微信/ }));

    expect(
      await screen.findByRole('heading', { name: '配置通知渠道' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Webhook 地址')).toBeInTheDocument();
    expect(screen.queryByText('机器人 Key')).not.toBeInTheDocument();
  });

  it('opens notification logs and renders failed reasons', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === providersEndpoint) {
        return Promise.resolve(jsonResponse({ providers }));
      }
      if (url === `${logsEndpoint}?limit=100`) {
        return Promise.resolve(
          jsonResponse({
            logs: [
              {
                eventType: 'watching.update_found',
                provider: 'webhook',
                channelId: 'channel-1',
                status: 'failed',
                error: 'send failed',
                time: 1_700_000_000_000,
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ settings: baseSettings }));
    });
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '通知日志' }));

    expect(
      await screen.findByRole('heading', { name: '通知日志' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('watching.update_found'),
    ).toBeInTheDocument();
    expect(screen.getByText('webhook')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('send failed')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${logsEndpoint}?limit=100`, {
      cache: 'no-store',
    });
  });
});
