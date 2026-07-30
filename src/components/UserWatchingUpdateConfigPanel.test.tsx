import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import UserWatchingUpdateConfigPanel from './UserWatchingUpdateConfigPanel';

const originalFetch = global.fetch;

function configResponse({
  permission = true,
  override = null,
  cronExpression = '*/30 * * * *',
  timezone = 'UTC',
  logRetentionCount = 200,
  sources = {
    cron: 'system',
    timezone: 'system',
    retention: 'system',
  },
}: {
  permission?: boolean;
  override?: {
    cronExpression?: string;
    timezone?: string;
    logRetentionCount?: number;
  } | null;
  cronExpression?: string;
  timezone?: string;
  logRetentionCount?: number;
  sources?: {
    cron: 'user' | 'system' | 'default';
    timezone: 'user' | 'system' | 'default';
    retention: 'user' | 'system' | 'default';
  };
}) {
  return {
    username: 'alice',
    permission,
    override,
    effective: {
      enabled: permission,
      cronExpression,
      timezone,
      logRetentionCount,
    },
    sources,
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
            override: { cronExpression: '0 */6 * * *' },
            cronExpression: '0 */6 * * *',
            sources: {
              cron: 'user',
              timezone: 'system',
              retention: 'default',
            },
          }),
        ),
      ),
    );

    renderPanel();

    expect(await screen.findAllByText('0 */6 * * *')).toHaveLength(2);
    expect(screen.getByText('用户自定义')).toBeInTheDocument();
  });

  it('displays inherited system values', async () => {
    setFetch(jest.fn().mockResolvedValue(jsonResponse(configResponse({}))));

    renderPanel();

    expect(await screen.findAllByText('未设置')).toHaveLength(3);
    expect(screen.getAllByText('系统配置')).toHaveLength(3);
  });

  it('saves a custom cron expression', async () => {
    const initial = configResponse({});
    const saved = configResponse({
      override: { cronExpression: '0 */6 * * *' },
      cronExpression: '0 */6 * * *',
      sources: { ...initial.sources, cron: 'user' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);
    renderPanel();

    const cronGroup = await screen.findByRole('group', {
      name: 'Cron 配置模式',
    });
    fireEvent.click(
      cronGroup.querySelectorAll('button')[1] as HTMLButtonElement,
    );
    fireEvent.change(screen.getByLabelText('Cron Expression'), {
      target: { value: '0 */6 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Cron' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectRequest(fetchMock, 1, 'PATCH', {
      cronExpression: '0 */6 * * *',
    });
  });

  it('saves a custom timezone', async () => {
    const initial = configResponse({});
    const saved = configResponse({
      override: { timezone: 'Asia/Tokyo' },
      timezone: 'Asia/Tokyo',
      sources: { ...initial.sources, timezone: 'user' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);
    renderPanel();

    const timezoneGroup = await screen.findByRole('group', {
      name: 'Timezone 配置模式',
    });
    fireEvent.click(
      timezoneGroup.querySelectorAll('button')[1] as HTMLButtonElement,
    );
    fireEvent.change(screen.getByLabelText('IANA Timezone'), {
      target: { value: 'Asia/Tokyo' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Timezone' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectRequest(fetchMock, 1, 'PATCH', { timezone: 'Asia/Tokyo' });
  });

  it('saves a custom retention count', async () => {
    const initial = configResponse({});
    const saved = configResponse({
      override: { logRetentionCount: 500 },
      logRetentionCount: 500,
      sources: { ...initial.sources, retention: 'user' },
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);
    renderPanel();

    const retentionGroup = await screen.findByRole('group', {
      name: '日志保留数量 配置模式',
    });
    fireEvent.click(
      retentionGroup.querySelectorAll('button')[1] as HTMLButtonElement,
    );
    fireEvent.change(screen.getByLabelText('Log Retention Count'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 日志保留数量' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectRequest(fetchMock, 1, 'PATCH', { logRetentionCount: 500 });
  });

  it('clears one user override', async () => {
    const initial = configResponse({
      override: { cronExpression: '0 */6 * * *' },
      cronExpression: '0 */6 * * *',
      sources: {
        cron: 'user',
        timezone: 'system',
        retention: 'system',
      },
    });
    const cleared = configResponse({});
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(initial))
      .mockResolvedValueOnce(jsonResponse(cleared));
    setFetch(fetchMock);
    renderPanel();

    const cronGroup = await screen.findByRole('group', {
      name: 'Cron 配置模式',
    });
    fireEvent.click(cronGroup.querySelector('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: '恢复 Cron 继承' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectRequest(fetchMock, 1, 'DELETE', { field: 'cronExpression' });
  });

  it('shows a disabled update-check permission', async () => {
    setFetch(
      jest
        .fn()
        .mockResolvedValue(jsonResponse(configResponse({ permission: false }))),
    );

    renderPanel();

    expect(
      await screen.findByText(/当前授权状态：关闭，最终状态：停用/),
    ).toBeInTheDocument();
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

function expectRequest(
  fetchMock: jest.Mock,
  index: number,
  method: string,
  body: unknown,
) {
  expect(fetchMock.mock.calls[index][0]).toBe(
    '/api/admin/watching-updates/users/alice/config',
  );
  expect(fetchMock.mock.calls[index][1]?.method).toBe(method);
  expect(JSON.parse(String(fetchMock.mock.calls[index][1]?.body))).toEqual(
    body,
  );
}
