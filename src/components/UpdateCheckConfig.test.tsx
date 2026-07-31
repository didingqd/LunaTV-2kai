import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { AdminConfig } from '@/lib/admin.types';

import UpdateCheckConfig from './UpdateCheckConfig';

const originalFetch = global.fetch;

function adminConfig(enabled = false, cronExpression = '*/30 * * * *') {
  return {
    SystemConfig: {
      updateCheckBackendEnabled: enabled,
      updateCheckSchedulerEnabled: true,
      updateCheckCronExpression: cronExpression,
      updateCheckTimezone: 'UTC',
      updateCheckLogRetentionCount: 200,
      updateCheckBatchSize: 100,
      updateCheckMaxUsers: 1000,
      updateCheckMaxFollowPerUser: 100,
    },
    UserConfig: {
      Users: [
        { username: 'owner', role: 'owner' },
        {
          username: 'alice',
          role: 'user',
          updateCheckBackendEnabled: true,
        },
      ],
    },
  } as AdminConfig;
}

describe('UpdateCheckConfig', () => {
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

  it('loads and saves SystemConfig through the update check API', async () => {
    const saved = adminConfig(true, '0 * * * *');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ Role: 'owner', Config: adminConfig() }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, Config: saved }));
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    render(<UpdateCheckConfig />);

    expect(await screen.findByText(/用户追更配置保留/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: '追更系统' }));
    fireEvent.change(screen.getByLabelText('Linux Cron 表达式'), {
      target: { value: '0 * * * *' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() =>
      expect(screen.getByText(/仅 owner 和已授权用户/)).toBeInTheDocument(),
    );
    const request = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/config');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/settings/update-check');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect(request.systemConfig).toMatchObject({
      updateCheckBackendEnabled: true,
      updateCheckCronExpression: '0 * * * *',
      updateCheckLogRetentionCount: 200,
    });
  });
});

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}
