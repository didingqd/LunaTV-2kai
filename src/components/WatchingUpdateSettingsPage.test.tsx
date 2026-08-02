import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import WatchingUpdateSettingsPage from './WatchingUpdateSettingsPage';

jest.mock('./WatchingUpdateModeSetting', () => ({
  WatchingUpdateModeSetting: () => <div>追更更新获取</div>,
}));

jest.mock('./WatchCompletionThresholdSetting', () => ({
  WatchCompletionThresholdSetting: ({ username }: { username?: string }) => (
    <div>观看完成判定：{username}</div>
  ),
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(() => ({ username: 'alice' })),
}));

const originalFetch = global.fetch;

type ConfigResponse = {
  permission: {
    enabled: boolean;
    allowCustomSchedule: boolean;
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
  userTriggerEnabled?: boolean;
  adminTriggerEnabled?: boolean;
  effectiveEnabled?: boolean;
  createdAt: number | null;
  rotatedAt: number | null;
  expiresAt: number | null;
  hasToken: boolean;
  tokenConfigured?: boolean;
  expired: boolean;
  tokenId?: string | null;
  maskedToken?: string | null;
  canRevealToken?: boolean;
  triggerLink?: string | null;
  fullToken?: string;
  fullTriggerLink?: string | null;
};

function configResponse(
  overrides: Partial<ConfigResponse> = {},
): ConfigResponse {
  return {
    permission: {
      enabled: true,
      allowCustomSchedule: true,
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
    tokenId: null,
    maskedToken: null,
    canRevealToken: false,
    triggerLink: null,
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
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(configResponse()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(await screen.findByText('追更状态')).toBeInTheDocument();
    expect(screen.getByText('更新策略')).toBeInTheDocument();
    expect(screen.getByText('追更更新获取')).toBeInTheDocument();
    expect(screen.getByText('观看完成判定：alice')).toBeInTheDocument();
    expect(screen.getByText('调度设置')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/user/watching-updates/config',
      {
        cache: 'no-store',
      },
    );
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
      .mockResolvedValueOnce(jsonResponse(triggerStatus()))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(triggerStatus()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.change(await screen.findByLabelText('Cron 表达式'), {
      target: { value: '0 */6 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Cron' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expectRequest(fetchMock, 2, 'PATCH', { cronExpression: '0 */6 * * *' });
    expect(fetchMock.mock.calls[3][1]).toEqual({ cache: 'no-store' });
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
      .mockResolvedValueOnce(jsonResponse(triggerStatus()))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(triggerStatus()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.change(await screen.findByLabelText('IANA 时区'), {
      target: { value: 'Europe/Berlin' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存时区' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expectRequest(fetchMock, 2, 'PATCH', { timezone: 'Europe/Berlin' });
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
      .mockResolvedValueOnce(jsonResponse(triggerStatus()))
      .mockResolvedValueOnce(jsonResponse(inherited))
      .mockResolvedValueOnce(jsonResponse(inherited))
      .mockResolvedValueOnce(jsonResponse(triggerStatus()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: '恢复系统配置' }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expectRequest(fetchMock, 2, 'DELETE', {});
  });

  it('disables schedule editing when custom schedule is not allowed', async () => {
    setFetch(
      jest.fn().mockResolvedValue(
        jsonResponse(
          configResponse({
            permission: {
              enabled: true,
              allowCustomSchedule: false,
            },
          }),
        ),
      ),
    );

    render(<WatchingUpdateSettingsPage />);

    expect(
      await screen.findByText('管理员未允许修改自定义调度。'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Cron 表达式')).toBeDisabled();
    expect(screen.getByLabelText('IANA 时区')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存 Cron' })).toBeDisabled();
  });

  it('shows API errors from save requests', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(configResponse()))
      .mockResolvedValueOnce(jsonResponse(triggerStatus()))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Custom schedule is not allowed' }, 403),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.change(await screen.findByLabelText('Cron 表达式'), {
      target: { value: '0 */6 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Cron' }));

    expect(
      await screen.findByText('管理员未允许修改自定义调度'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows trigger link as not configured when no token exists', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(jsonResponse(triggerStatus()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(
      await screen.findByText('尚未生成触发链接 Token。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成 Token' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
            maskedToken: 'toke****cret',
            triggerLink:
              'http://localhost/api/update-check-trigger?token=toke****cret',
            createdAt: Date.UTC(2026, 0, 1),
            rotatedAt: Date.UTC(2026, 0, 2),
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(await screen.findByText('链接状态')).toBeInTheDocument();
    expect(screen.getByText('toke****cret')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看触发链接' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '复制链接' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '测试链接' })).toBeEnabled();
    expectTriggerRequest(fetchMock, 1);
  });

  it('keeps token lifecycle controls available when the user switch is closed', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: false,
            userTriggerEnabled: false,
            adminTriggerEnabled: true,
            effectiveEnabled: false,
            hasToken: true,
            maskedToken: 'toke****cret',
            triggerLink:
              'http://localhost/api/update-check-trigger?token=toke****cret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(
      await screen.findByText('我的开关已关闭，当前链接不可访问。'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('用户已关闭').length).toBeGreaterThan(0);
    expect(screen.getAllByText('更新检测触发链接').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '查看触发链接' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '复制链接' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '测试链接' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '启用触发链接' })).toBeEnabled();
  });

  it('keeps token lifecycle controls available when the admin switch is closed', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: false,
            userTriggerEnabled: true,
            adminTriggerEnabled: false,
            effectiveEnabled: false,
            hasToken: true,
            maskedToken: 'toke****cret',
            triggerLink:
              'http://localhost/api/update-check-trigger?token=toke****cret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(
      await screen.findByText('管理员已关闭触发权限，当前链接不可访问。'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('管理员已关闭').length).toBeGreaterThan(0);
    expect(screen.getAllByText('更新检测触发链接').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '查看触发链接' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '复制链接' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '测试链接' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: '启用触发链接' }),
    ).not.toBeInTheDocument();
  });

  it('generates a user-owned trigger token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(jsonResponse(triggerStatus()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            userTriggerEnabled: true,
            adminTriggerEnabled: true,
            effectiveEnabled: true,
            hasToken: true,
            maskedToken: 'toke****cret',
            fullToken: 'token.secret',
            fullTriggerLink:
              'http://localhost/api/update-check-trigger?token=token.secret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '生成 Token' }));

    expect(
      await screen.findByDisplayValue(
        'http://localhost/api/update-check-trigger?token=token.secret',
      ),
    ).toBeInTheDocument();
    expectTriggerRequest(fetchMock, 2, 'POST', { action: 'generate' });
  });

  it('regenerates the current user trigger token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            maskedToken: 'old****cret',
            triggerLink:
              'http://localhost/api/update-check-trigger?token=old****cret',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            maskedToken: 'new****cret',
            fullToken: 'new.secret',
            fullTriggerLink:
              'http://localhost/api/update-check-trigger?token=new.secret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));

    expect(
      await screen.findByDisplayValue(
        'http://localhost/api/update-check-trigger?token=new.secret',
      ),
    ).toBeInTheDocument();
    expectTriggerRequest(fetchMock, 2, 'POST', { action: 'generate' });
  });

  it('shows token and trigger controls after the user re-enables the link', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: false,
            userTriggerEnabled: false,
            adminTriggerEnabled: true,
            effectiveEnabled: false,
            hasToken: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            userTriggerEnabled: true,
            adminTriggerEnabled: true,
            effectiveEnabled: true,
            hasToken: true,
            maskedToken: 'toke****cret',
            triggerLink:
              'http://localhost/api/update-check-trigger?token=toke****cret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: '启用触发链接' }),
    );

    expect(await screen.findByText('toke****cret')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看触发链接' })).toBeEnabled();
    expectTriggerRequest(fetchMock, 2, 'PATCH', { enabled: true });
  });

  it('reveals the full trigger link on demand', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            maskedToken: 'toke****cret',
            triggerLink:
              'http://localhost/api/update-check-trigger?token=toke****cret',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            maskedToken: 'toke****cret',
            fullToken: 'token.secret',
            fullTriggerLink:
              'http://localhost/api/update-check-trigger?token=token.secret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: '查看触发链接' }),
    );

    expect(
      await screen.findByDisplayValue(
        'http://localhost/api/update-check-trigger?token=token.secret',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '复制链接' }),
    ).toBeInTheDocument();
    expectTriggerRequest(fetchMock, 2, 'PUT', { action: 'reveal' });
  });

  it('copies the trigger link without requiring a prior reveal or test', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            effectiveEnabled: true,
            hasToken: true,
            maskedToken: 'toke****cret',
            triggerLink:
              'http://0.0.0.0:3000/api/update-check-trigger?token=toke****cret',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            effectiveEnabled: true,
            hasToken: true,
            maskedToken: 'toke****cret',
            fullToken: 'token.secret',
            fullTriggerLink:
              'http://0.0.0.0:3000/api/update-check-trigger?token=token.secret',
          }),
        ),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '复制链接' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/api/update-check-trigger?token=token.secret`,
      ),
    );
    expectTriggerRequest(fetchMock, 2, 'PUT', { action: 'reveal' });
  });

  it('tests the trigger link through the current site trigger endpoint', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            maskedToken: 'toke****cret',
            triggerLink:
              'http://0.0.0.0:3000/api/update-check-trigger?token=toke****cret',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          triggerStatus({
            enabled: true,
            hasToken: true,
            maskedToken: 'toke****cret',
            fullToken: 'token.secret',
            fullTriggerLink:
              'http://0.0.0.0:3000/api/update-check-trigger?token=token.secret',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          accepted: true,
          status: 'running',
          running: true,
          taskId: 'task-1',
        }),
      );
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: '测试链接' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expectTriggerRequest(fetchMock, 2, 'PUT', { action: 'reveal' });
    expect(fetchMock.mock.calls[3][0]).toBe(
      `${window.location.origin}/api/update-check-trigger?token=token.secret`,
    );
    expect(await screen.findByText('请求成功')).toBeInTheDocument();
    expect(screen.getByText('当前检测状态：running')).toBeInTheDocument();
    expect(screen.getByText('是否启动任务：是')).toBeInTheDocument();
  });

  it('shows when the token is not configured', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(triggerAllowedConfig()))
      .mockResolvedValueOnce(jsonResponse(triggerStatus()));
    setFetch(fetchMock);

    render(<WatchingUpdateSettingsPage />);

    expect(
      await screen.findByText('尚未生成触发链接 Token。'),
    ).toBeInTheDocument();
  });
});
