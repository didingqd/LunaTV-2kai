import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import WatchingUpdateSettingsPage from './WatchingUpdateSettingsPage';

const originalFetch = global.fetch;

type ConfigResponse = {
  permission: {
    enabled: boolean;
    allowCustomSchedule: boolean;
    allowTriggerLink: boolean;
  };
  userConfig: {
    cronExpression?: string;
    timezone?: string;
    triggerLink?: unknown;
  } | null;
  effectiveConfig: {
    enabled: boolean;
    cronExpression: string;
    timezone: string;
  };
  sources: {
    cron: 'user' | 'system' | 'default';
    timezone: 'user' | 'system' | 'default';
  };
};

type TriggerLinkStatusResponse = {
  enabled: boolean;
  createdAt: number | null;
  rotatedAt: number | null;
  expiresAt: number | null;
  hasToken: boolean;
  expired: boolean;
  plainToken?: string;
};

function configResponse(overrides: Partial<ConfigResponse> = {}): ConfigResponse {
  return {
    permission: {
      enabled: true,
      allowCustomSchedule: true,
      allowTriggerLink: false,
    },
    userConfig: null,
    effectiveConfig: {
      enabled: true,
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
    },
    sources: {
      cron: 'system',
      timezone: 'system',
    },
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function triggerStatus(
  overrides: Partial<TriggerLinkStatusResponse> = {},
): TriggerLinkStatusResponse {
  return {
    enabled: false,
    createdAt: null,
    rotatedAt: null,
    expiresAt: null,
    hasToken: false,
    expired: false,
    ...overrides,
  };
}

function setFetch(fetchMock: jest.Mock) {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
}

function expectRequest(
  fetchMock: jest.Mock,
  index: number,
  method: string,
  body?: Record<string, unknown>,
) {
  expect(fetchMock.mock.calls[index][0]).toBe(
    '/api/user/watching-updates/config',
  );
  expect(fetchMock.mock.calls[index][1]?.method).toBe(method);
  if (body !== undefined) {
    expect(JSON.parse(String(fetchMock.mock.calls[index][1]?.body))).toEqual(
      body,
    );
  }
}

function expectTriggerRequest(
  fetchMock: jest.Mock,
  index: number,
  method?: string,
  body?: Record<string, unknown>,
) {
  expect(fetchMock.mock.calls[index][0]).toBe(
    '/api/user/watching-updates/trigger-link',
  );
  if (method) expect(fetchMock.mock.calls[index][1]?.method).toBe(method);
  if (body !== undefined) {
    expect(JSON.parse(String(fetchMock.mock.calls[index][1]?.body))).toEqual(
      body,
    );
  }
}

function triggerAllowedConfig(overrides: Partial<ConfigResponse> = {}) {
  return configResponse({
    permission: {
      enabled: true,
      allowCustomSchedule: true,
      allowTriggerLink: true,
    },
    ...overrides,
  });
}

describe('WatchingUpdateSettingsPage', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
    jest.restoreAllMocks();
  });

  it('loads the current user watching update config', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(configResponse()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(await screen.findByText('追更状态')).toBeInTheDocument();
    expect(screen.getByText('调度设置')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/user/watching-updates/config', {
      cache: 'no-store',
    });
  });

  it('shows the effective config and sources', async () => {
    setFetch(
      jest.fn().mockResolvedValue(
        jsonResponse(
          configResponse({
            effectiveConfig: {
              enabled: true,
              cronExpression: '0 */6 * * *',
              timezone: 'Asia/Shanghai',
            },
            sources: { cron: 'user', timezone: 'default' },
          }),
        ),
      ),
    );

    render(<WatchingUpdateSettingsPage />);

    expect(await screen.findByText('0 */6 * * *')).toBeInTheDocument();
    expect(screen.getAllByText('Asia/Shanghai').length).toBeGreaterThan(0);
    expect(screen.getByText('来源：用户配置')).toBeInTheDocument();
    expect(screen.getByText('来源：默认值')).toBeInTheDocument();
  });

  it('saves a user cron override', async () => {
    const saved = configResponse({
      userConfig: { cronExpression: '0 */6 * * *' },
      effectiveConfig: {
        enabled: true,
        cronExpression: '0 */6 * * *',
        timezone: 'UTC',
      },
      sources: { cron: 'user', timezone: 'system' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(configResponse()))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.change(await screen.findByLabelText('Cron Expression'), {
      target: { value: '0 */6 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Cron' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expectRequest(fetchMock, 1, 'PATCH', { cronExpression: '0 */6 * * *' });
    expect(fetchMock.mock.calls[2][1]).toEqual({ cache: 'no-store' });
  });

  it('saves a user timezone override', async () => {
    const saved = configResponse({
      userConfig: { timezone: 'Europe/Berlin' },
      effectiveConfig: {
        enabled: true,
        cronExpression: '*/30 * * * *',
        timezone: 'Europe/Berlin',
      },
      sources: { cron: 'system', timezone: 'user' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(configResponse()))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.change(await screen.findByLabelText('IANA Timezone'), {
      target: { value: 'Europe/Berlin' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Timezone' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expectRequest(fetchMock, 1, 'PATCH', { timezone: 'Europe/Berlin' });
  });

  it('clears overrides and returns to inherited config', async () => {
    const initial = configResponse({
      userConfig: {
        cronExpression: '0 */6 * * *',
        timezone: 'Asia/Tokyo',
      },
      effectiveConfig: {
        enabled: true,
        cronExpression: '0 */6 * * *',
        timezone: 'Asia/Tokyo',
      },
      sources: { cron: 'user', timezone: 'user' },
    });
    const inherited = configResponse({
      userConfig: null,
      effectiveConfig: {
        enabled: true,
        cronExpression: '*/30 * * * *',
        timezone: 'UTC',
      },
      sources: { cron: 'system', timezone: 'system' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse(inherited))
      .mockResolvedValueOnce(jsonResponse(inherited));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '恢复系统配置' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expectRequest(fetchMock, 1, 'DELETE', {});
  });

  it('disables schedule editing when custom schedule is not allowed', async () => {
    setFetch(
      jest.fn().mockResolvedValue(
        jsonResponse(
          configResponse({
            permission: {
              enabled: true,
              allowCustomSchedule: false,
              allowTriggerLink: false,
            },
          }),
        ),
      ),
    );

    render(<WatchingUpdateSettingsPage />);

    expect(
      await screen.findByText('管理员未允许修改自定义调度。'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Cron Expression')).toBeDisabled();
    expect(screen.getByLabelText('IANA Timezone')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存 Cron' })).toBeDisabled();
  });

  it('shows API errors from save requests', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(configResponse()))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Custom schedule is not allowed' }, 403),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.change(await screen.findByLabelText('Cron Expression'), {
      target: { value: '0 */6 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Cron' }));

    expect(
      await screen.findByText('管理员未允许修改自定义调度'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows trigger link as unavailable when it is not allowed', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(configResponse()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(
      await screen.findByText('管理员未允许使用 Trigger Link。'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads trigger link status when allowed', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            createdAt: Date.UTC(2026, 0, 1),
            rotatedAt: Date.UTC(2026, 0, 2),
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(await screen.findByText('Token 状态')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '轮换 Token' })).toBeEnabled();
    expectTriggerRequest(fetchMock, 1);
  });

  it('creates a trigger token and shows the plain token once', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(jsonResponse(triggerStatus()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            createdAt: 1000,
            rotatedAt: 1000,
            plainToken: 'token.secret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '创建 Token' }));

    expect(await screen.findByDisplayValue('token.secret')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument();
    expectTriggerRequest(fetchMock, 2, 'POST');
  });

  it('rotates a trigger token and shows the new plain token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(triggerStatus({ enabled: true, hasToken: true })),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            plainToken: 'token.new-secret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '轮换 Token' }));

    expect(
      await screen.findByDisplayValue('token.new-secret'),
    ).toBeInTheDocument();
    expectTriggerRequest(fetchMock, 2, 'PATCH', { action: 'rotate' });
  });

  it('enables and disables a trigger token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(triggerStatus({ enabled: true, hasToken: true })),
      )
      .mockResolvedValueOnce(
        jsonResponse(triggerStatus({ enabled: false, hasToken: true })),
      )
      .mockResolvedValueOnce(
        jsonResponse(triggerStatus({ enabled: true, hasToken: true })),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '禁用' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '启用' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: '启用' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expectTriggerRequest(fetchMock, 2, 'PATCH', { enabled: false });
    expectTriggerRequest(fetchMock, 3, 'PATCH', { enabled: true });
  });

  it('deletes a trigger token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(triggerStatus({ enabled: true, hasToken: true })),
      )
      .mockResolvedValueOnce(jsonResponse(triggerStatus()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expectTriggerRequest(fetchMock, 2, 'DELETE');
    expect(await screen.findByText('未创建')).toBeInTheDocument();
  });
});
