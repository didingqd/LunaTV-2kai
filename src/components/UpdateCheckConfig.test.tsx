import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import UpdateCheckConfig from './UpdateCheckConfig';

const localSettings = {
  enabled: false,
  updateCheckCronInterval: 30 * 60 * 1000,
  batchSize: 100,
  maxUsers: 1000,
  maxFollowPerUser: 100,
  users: [],
};
const originalFetch = global.fetch;

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

  it('uses the saved server response as the current UI state', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(localSettings))
      .mockResolvedValueOnce(
        jsonResponse({
          ...localSettings,
          enabled: true,
          updateCheckCronInterval: 6 * 60 * 60 * 1000,
        }),
      );
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
    expect(screen.getByLabelText('Cron 调度周期')).toHaveValue(
      String(6 * 60 * 60 * 1000),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      enabled: true,
      updateCheckCronInterval: 6 * 60 * 60 * 1000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}
