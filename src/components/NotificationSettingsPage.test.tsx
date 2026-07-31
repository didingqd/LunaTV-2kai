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

const baseSettings = {
  version: 2,
  notificationCenterEnabled: true,
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
});
