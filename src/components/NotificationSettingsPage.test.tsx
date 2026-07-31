import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import NotificationSettingsPage from './NotificationSettingsPage';

const originalFetch = global.fetch;

const defaultSettings = {
  inboxEnabled: true,
  watchingUpdateFoundEnabled: true,
  watchingUpdateFailedEnabled: true,
  channels: [
    {
      id: 'inbox',
      type: 'inbox',
      name: '站内通知',
      enabled: true,
      config: {},
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

describe('NotificationSettingsPage', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
    jest.restoreAllMocks();
  });

  it('loads current settings', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ settings: defaultSettings }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    expect(screen.getByText('正在加载通知设置')).toBeInTheDocument();
    expect(await screen.findByText('通知设置')).toBeInTheDocument();
    expect((await screen.findAllByText('站内通知')).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/user/notification-settings', {
      cache: 'no-store',
    });
  });

  it('saves changed settings', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ settings: defaultSettings }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { ...defaultSettings, watchingUpdateFoundEnabled: false },
        }),
      );
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(await screen.findByLabelText('发现更新'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/user/notification-settings');
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      inboxEnabled: true,
      watchingUpdateFoundEnabled: false,
      watchingUpdateFailedEnabled: true,
    });
    expect(await screen.findByText('通知设置已保存')).toBeInTheDocument();
  });

  it('creates a WeChat Work channel', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ settings: defaultSettings }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            ...defaultSettings,
            channels: [
              ...defaultSettings.channels,
              {
                id: 'wc-1',
                type: 'wechat_work',
                name: '我的企业微信',
                enabled: true,
                config: {
                  webhookUrl: 'https://qyapi.weixin.qq.com/****abcd',
                },
              },
            ],
          },
        }),
      );
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '添加通知方式' }));
    fireEvent.change(screen.getByLabelText('通知方式名称'), {
      target: { value: '我的企业微信' },
    });
    fireEvent.change(screen.getByLabelText('企业微信 Webhook URL'), {
      target: {
        value: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/user/notification-settings/channels',
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      type: 'wechat_work',
      name: '我的企业微信',
      config: {
        webhookUrl:
          'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd',
      },
    });
    expect(await screen.findByText('通知方式已添加')).toBeInTheDocument();
  });

  it('restores default settings', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { ...defaultSettings, inboxEnabled: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ settings: defaultSettings }));
    setFetch(fetchMock);

    render(<NotificationSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '恢复默认' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
    expect(await screen.findByText('已恢复默认通知设置')).toBeInTheDocument();
  });

  it('shows API errors', async () => {
    setFetch(
      jest
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'settings failed' }, 500)),
    );

    render(<NotificationSettingsPage />);

    expect(await screen.findByText('settings failed')).toBeInTheDocument();
  });

  it('shows unauthenticated errors', async () => {
    setFetch(jest.fn().mockResolvedValue(jsonResponse({}, 401)));

    render(<NotificationSettingsPage />);

    expect(
      await screen.findByText('请先登录后修改通知设置'),
    ).toBeInTheDocument();
  });
});
