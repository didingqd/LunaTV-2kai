import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { AdminConfig } from '@/lib/admin.types';

import UpdateCheckConfig from './UpdateCheckConfig';

const originalFetch = global.fetch;

function adminConfig(enabled = false, interval = 30 * 60 * 1000) {
  return {
    SystemConfig: {
      updateCheckBackendEnabled: enabled,
      updateCheckSchedulerEnabled: true,
      updateCheckCronInterval: interval,
      updateCheckCronExpression: '*/30 * * * *',
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

  it('loads and saves SystemConfig through the existing admin config API', async () => {
    const saved = adminConfig(true, 6 * 60 * 60 * 1000);
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

    expect(await screen.findByText(/所有用户使用本地计算/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: '后端追更计算' }));
    fireEvent.change(screen.getByLabelText('Cron 调度周期'), {
      target: { value: String(6 * 60 * 60 * 1000) },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() =>
      expect(screen.getByText(/仅 owner 和已授权用户/)).toBeInTheDocument(),
    );
    const request = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/config');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/config');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
    expect(request.SystemConfig).toMatchObject({
      updateCheckBackendEnabled: true,
      updateCheckCronInterval: 6 * 60 * 60 * 1000,
    });
  });
});

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}
