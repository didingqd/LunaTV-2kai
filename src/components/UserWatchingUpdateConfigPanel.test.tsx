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
    const fetchMock = jest.fn().mockResolvedValue(
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
    expect(screen.getByText('User Config')).toBeInTheDocument();
  });

  it('displays inherited system values', async () => {
    setFetch(jest.fn().mockResolvedValue(jsonResponse(configResponse())));

    renderPanel();

    expect(await screen.findAllByText('Not set')).toHaveLength(2);
    expect(screen.getAllByText('System Config')).toHaveLength(2);
  });

  it('saves a custom cron expression', async () => {
    const initial = configResponse();
    const saved = configResponse({
      userConfig: { cronExpression: '0 */6 * * *' },
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
      name: 'Cron config mode',
    });
    fireEvent.click(
      cronGroup.querySelectorAll('button')[1] as HTMLButtonElement,
    );
    fireEvent.change(screen.getByLabelText('Cron Expression'), {
      target: { value: '0 */6 * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Cron' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectConfigRequest(fetchMock, 1, 'PATCH', {
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
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);
    renderPanel();

    const timezoneGroup = await screen.findByRole('group', {
      name: 'Timezone config mode',
    });
    fireEvent.click(
      timezoneGroup.querySelectorAll('button')[1] as HTMLButtonElement,
    );
    fireEvent.change(screen.getByLabelText('IANA Timezone'), {
      target: { value: 'Asia/Tokyo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Timezone' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectConfigRequest(fetchMock, 1, 'PATCH', { timezone: 'Asia/Tokyo' });
  });

  it('clears one user override', async () => {
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
      .mockResolvedValueOnce(jsonResponse(cleared));
    setFetch(fetchMock);
    renderPanel();

    const cronGroup = await screen.findByRole('group', {
      name: 'Cron config mode',
    });
    fireEvent.click(cronGroup.querySelector('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Cron Override' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectConfigRequest(fetchMock, 1, 'DELETE', { field: 'cronExpression' });
  });

  it('shows and saves custom schedule and trigger link limits', async () => {
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
      .mockResolvedValueOnce(jsonResponse(saved));
    setFetch(fetchMock);
    renderPanel();

    expect(await screen.findByText('Ability Limits')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('switch', { name: 'Allow user custom schedule' }),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Allow Trigger Link' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Ability Limits' }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectConfigRequest(fetchMock, 1, 'PATCH', {
      allowCustomSchedule: false,
      allowTriggerLink: true,
    });
  });

  it('does not display log retention editing', async () => {
    setFetch(jest.fn().mockResolvedValue(jsonResponse(configResponse())));

    renderPanel();

    expect(await screen.findByText('User Config Management')).toBeInTheDocument();
    expect(screen.queryByLabelText('Log Retention Count')).not.toBeInTheDocument();
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

    expect(await screen.findByText('Authorization: Disabled')).toBeInTheDocument();
    expect(screen.getByText('Effective status: Disabled')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Update-check authorization' }),
    ).not.toBeChecked();
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
  expect(JSON.parse(String(fetchMock.mock.calls[index][1]?.body))).toEqual(
    body,
  );
}
