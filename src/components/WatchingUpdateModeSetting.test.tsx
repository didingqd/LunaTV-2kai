import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WatchingUpdateModeSetting } from './WatchingUpdateModeSetting';
import { WATCHING_UPDATE_SOURCE_MODE_KEY } from '@/lib/watching-update-preference';
import { watchingUpdatesService } from '@/lib/watching-updates-service';

jest.mock('@/lib/watching-updates-service', () => ({
  watchingUpdatesService: {
    resolveMode: jest.fn(),
  },
}));

const service = jest.mocked(watchingUpdatesService);

describe('WatchingUpdateModeSetting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('defaults to local without checking backend capability', () => {
    render(<WatchingUpdateModeSetting />);

    expect(screen.getByRole('radio', { name: /本地计算/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText('当前使用本地计算。')).toBeInTheDocument();
    expect(service.resolveMode).not.toHaveBeenCalled();
  });

  it('confirms that backend calculation is available after switching', async () => {
    service.resolveMode.mockResolvedValue({
      requestedMode: 'backend',
      effectiveMode: 'backend',
      capabilityState: 'available',
      capability: {
        supported: true,
        enabled: true,
        userAllowed: true,
        mode: 'backend',
      },
    });
    render(<WatchingUpdateModeSetting />);

    fireEvent.click(screen.getByRole('radio', { name: /后端获取/ }));

    expect(screen.getByText(/正在确认当前账号/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText(/当前账号可以使用后端追更计算/),
      ).toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(WATCHING_UPDATE_SOURCE_MODE_KEY)).toBe(
      'backend',
    );
  });

  it('explains when the current account is not authorized', async () => {
    service.resolveMode.mockResolvedValue({
      requestedMode: 'backend',
      effectiveMode: 'local',
      capabilityState: 'unavailable',
      capability: {
        supported: true,
        enabled: true,
        userAllowed: false,
        mode: 'local',
      },
    });
    render(<WatchingUpdateModeSetting />);

    fireEvent.click(screen.getByRole('radio', { name: /后端获取/ }));

    await waitFor(() =>
      expect(
        screen.getByText(/当前账号未获后端追更计算授权/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/将继续使用本地计算/)).toBeInTheDocument();
  });

  it('reports capability check failures and keeps the effective local mode', async () => {
    service.resolveMode.mockResolvedValue({
      requestedMode: 'backend',
      effectiveMode: 'local',
      capabilityState: 'error',
    });
    render(<WatchingUpdateModeSetting />);

    fireEvent.click(screen.getByRole('radio', { name: /后端获取/ }));

    await waitFor(() =>
      expect(screen.getByText(/无法确认后端计算能力/)).toBeInTheDocument(),
    );
  });
});
