import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import UserWatchingUpdateConfigPanel from './UserWatchingUpdateConfigPanel';

const originalFetch = global.fetch;

function configResponse({
  permission = {
    enabled: true,
    allowCustomSchedule: true,
    allowTriggerLink: false,
  },
  userConfig = null,
  cronExpression = '*/30 * * * *',
  timezone = 'UTC',
  sources = {
    cron: 'system',
    timezone: 'system',
  },
}: {
  permission?: {
    enabled: boolean;
    allowCustomSchedule: boolean;
    allowTriggerLink: boolean;
  };
  userConfig?: {
    cronExpression?: string;
    timezone?: string;
  } | null;
  cronExpression?: string;
  timezone?: string;
  sources?: {
    cron: 'user' | 'system' | 'default';
    timezone: 'user' | 'system' | 'default';
  };
} = {}) {
  return {
    username: 'alice',
    permission,
    userConfig,
    effective: {
      enabled: permission.enabled,
      cronExpression,
      timezone,
    },
    sources,
    audit: {
      updatedAt: 1000,
      operator: 'owner',
    },
    triggerLinkAccessControl: {
      enabled: true,
      ipLimit: {
        enabled: true,
        windowMinutes: 60,
        maxAttempts: 5,
        blockMinutes: 30,
      },
      userLimit: {
        enabled: true,
        windowMinutes: 1440,
        maxAttempts: 20,
      },
      autoDisable: {
        enabled: true,
        violationThreshold: 3,
        violationWindowMinutes: 60,
      },
    },
  };
}

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

function renderPanel(onRefresh = jest.fn().mockResolvedValue(undefined)) {
  render(
    <UserWatchingUpdateConfigPanel
      username='alice'
      userRole='user'
      systemUpdateCheckEnabled={true}
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

describe('UserWatchingUpdateConfigPanel', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it('loads the user config from the Management API', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          configResponse({ cronExpression: '0 */6 * * *', timezone: 'UTC' }),
        ),
      );
    setFetch(fetchMock);

    renderPanel();

    expect(await screen.findByText('0 */6 * * *')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/watching-updates/users/alice/config',
      { cache: 'no-store' },
    );
  });

  it('displays user overrides and their source', async () => {
    setFetch(
      jest.fn().mockResolvedValue(
        jsonResponse(
          configResponse({
            userConfig: { cronExpression: '0 */6 * * *' },
            cronExpression: '0 */6 * * *',
            sources: {
              cron: 'user',
              timezone: 'system',
            },
          }),
        ),
      ),
    );

    renderPanel();

    expect(await screen.findAllByText('0 */6 * * *')).toHaveLength(2);
    expect(screen.getByText('用户配置')).toBeInTheDocument();
  });

  it('displays inherited system values', async () => {
    setFetch(jest.fn().mockResolvedValue(jsonResponse(configResponse())));

    renderPanel();

    expect(await screen.findAllByText('未设置')).toHaveLength(2);
    expect(screen.getAllByText('系统配置')).toHaveLength(2);
  });

  it('saves all settings with a custom cron expression', async () => {
    const initial = configResponse();
    const saved = configResponse({
      userConfig: { cronExpression: '0 */6 * * *' },
      cronExpression: '0 */6 * * *',
      sources: { ...initial.sources, cron: 'user' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);
    renderPanel();

    const cronGroup = await screen.findByRole('group', {
      name: 'Cron 配置模式',
    });
    fireEvent.click(
      cronGroup.querySelectorAll('button')[1] as HTMLButtonElement,
    );
    fireEvent.change(screen.getByLabelText('Cron 表达式'), {
      target: { value: '0 */6 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存全部设置' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[2][0]).toBe(
      '/api/admin/settings/update-check/permissions',
    );
    expectConfigRequest(fetchMock, 3, 'PATCH', {
      allowCustomSchedule: true,
      allowTriggerLink: false,
      cronExpression: '0 */6 * * *',
    });
  });

  it('saves a custom timezone', async () => {
    const initial = configResponse();
    const saved = configResponse({
      userConfig: { timezone: 'Asia/Tokyo' },
      timezone: 'Asia/Tokyo',
      sources: { ...initial.sources, timezone: 'user' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);
    renderPanel();

    const timezoneGroup = await screen.findByRole('group', {
      name: '时区 配置模式',
    });
    fireEvent.click(
      timezoneGroup.querySelectorAll('button')[1] as HTMLButtonElement,
    );
    fireEvent.change(screen.getByLabelText('IANA 时区'), {
      target: { value: 'Asia/Tokyo' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存全部设置' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expectConfigRequest(fetchMock, 3, 'PATCH', {
      allowCustomSchedule: true,
      allowTriggerLink: false,
      timezone: 'Asia/Tokyo',
    });
  });

  it('clears one user override when saving all inherited settings', async () => {
    const initial = configResponse({
      userConfig: { cronExpression: '0 */6 * * *' },
      cronExpression: '0 */6 * * *',
      sources: {
        cron: 'user',
        timezone: 'system',
      },
    });
    const cleared = configResponse();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse(cleared))
      .mockResolvedValueOnce(jsonResponse(cleared));
    setFetch(fetchMock);
    renderPanel();

    const cronGroup = await screen.findByRole('group', {
      name: 'Cron 配置模式',
    });
    fireEvent.click(cronGroup.querySelector('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: '保存全部设置' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expectConfigRequest(fetchMock, 3, 'PATCH', {
      allowCustomSchedule: true,
      allowTriggerLink: false,
    });
    expectConfigRequest(fetchMock, 4, 'DELETE', { field: 'cronExpression' });
  });

  it('saves permission, custom schedule, and trigger link in one action', async () => {
    const initial = configResponse({
      permission: {
        enabled: true,
        allowCustomSchedule: true,
        allowTriggerLink: false,
      },
    });
    const saved = configResponse({
      permission: {
        enabled: true,
        allowCustomSchedule: false,
        allowTriggerLink: true,
      },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse(saved))
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);
    renderPanel();

    expect(await screen.findByText('能力限制')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: '允许用户自定义调度' }));
    fireEvent.click(screen.getByRole('switch', { name: '允许触发链接' }));
    fireEvent.click(screen.getByRole('button', { name: '保存全部设置' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[2][0]).toBe(
      '/api/admin/settings/update-check/permissions',
    );
    expectConfigRequest(fetchMock, 3, 'PATCH', {
      allowCustomSchedule: false,
      allowTriggerLink: true,
    });
  });

  it('does not display log retention editing', async () => {
    setFetch(jest.fn().mockResolvedValue(jsonResponse(configResponse())));

    renderPanel();

    expect(await screen.findByText('用户配置管理')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Log Retention Count'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Retention/i)).not.toBeInTheDocument();
  });

  it('shows a disabled update-check permission', async () => {
    setFetch(
      jest.fn().mockResolvedValue(
        jsonResponse(
          configResponse({
            permission: {
              enabled: false,
              allowCustomSchedule: true,
              allowTriggerLink: false,
            },
          }),
        ),
      ),
    );

    renderPanel();

    expect(await screen.findByText('授权状态：已禁用')).toBeInTheDocument();
    expect(screen.getByText('生效状态：已禁用')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '追更授权' })).not.toBeChecked();
  });
});

function setFetch(fetchMock: jest.Mock) {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
}

function expectConfigRequest(
  fetchMock: jest.Mock,
  index: number,
  method: string,
  body: unknown,
) {
  expect(fetchMock.mock.calls[index][0]).toBe(
    '/api/admin/watching-updates/users/alice/config',
  );
  expect(fetchMock.mock.calls[index][1]?.method).toBe(method);
  expect(
    JSON.parse(String(fetchMock.mock.calls[index][1]?.body)),
  ).toMatchObject(body);
}
