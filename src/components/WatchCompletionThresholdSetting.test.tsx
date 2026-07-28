import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { WatchCompletionThresholdSetting } from './WatchCompletionThresholdSetting';
import { watchCompletionThresholdStorageKey } from '@/lib/watching-update-calculation';

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderSetting(username?: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    queryClient,
    ...render(<WatchCompletionThresholdSetting username={username} />, {
      wrapper,
    }),
  };
}

describe('WatchCompletionThresholdSetting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('loads the current user threshold when the setting opens', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ watchCompletionThreshold: 50 }),
    );

    renderSetting('alice');

    const slider = screen.getByRole('slider', {
      name: '观看完成判定',
    }) as HTMLInputElement;
    await waitFor(() => expect(slider.value).toBe('50'));
    expect(screen.getByText('观看完成判定：50%')).toBeInTheDocument();
  });

  it('updates the slider draft and saves it through PUT', async () => {
    let serverThreshold = 80;
    global.fetch = jest.fn(async (_input, init) => {
      if (init?.method === 'PUT') {
        serverThreshold = JSON.parse(
          String(init.body),
        ).watchCompletionThreshold;
      }
      return jsonResponse({ watchCompletionThreshold: serverThreshold });
    });

    renderSetting('alice');

    const slider = screen.getByRole('slider', {
      name: '观看完成判定',
    }) as HTMLInputElement;
    await waitFor(() => expect(slider.value).toBe('80'));

    fireEvent.change(slider, { target: { value: '50' } });
    expect(screen.getByText('观看完成判定：50%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/user/watch-completion-threshold',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ watchCompletionThreshold: 50 }),
        },
      ),
    );
    expect(
      window.localStorage.getItem(watchCompletionThresholdStorageKey('alice')),
    ).toBe('50');
  });

  it('restores the previous value and shows an error when PUT fails', async () => {
    global.fetch = jest.fn(async (_input, init) => {
      if (init?.method === 'PUT') {
        return jsonResponse({ error: '保存失败' }, 500);
      }
      return jsonResponse({ watchCompletionThreshold: 80 });
    });

    renderSetting('alice');

    const slider = screen.getByRole('slider', {
      name: '观看完成判定',
    }) as HTMLInputElement;
    await waitFor(() => expect(slider.value).toBe('80'));

    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    await waitFor(() => expect(slider.value).toBe('80'));
    expect(screen.getByText('保存失败')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('保存失败');
  });

  it('uses account-scoped cache when accounts switch and the API is unavailable', async () => {
    window.localStorage.setItem(
      watchCompletionThresholdStorageKey('alice'),
      '50',
    );
    window.localStorage.setItem(
      watchCompletionThresholdStorageKey('bob'),
      '90',
    );
    global.fetch = jest.fn(async () => jsonResponse({ error: 'offline' }, 500));

    const { rerender } = renderSetting('alice');

    const slider = screen.getByRole('slider', {
      name: '观看完成判定',
    }) as HTMLInputElement;
    await waitFor(() => expect(slider.value).toBe('50'));

    rerender(<WatchCompletionThresholdSetting username='bob' />);

    await waitFor(() => expect(slider.value).toBe('90'));
  });

  it('is hidden for unauthenticated users', () => {
    global.fetch = jest.fn();

    renderSetting(null);

    expect(
      screen.queryByTestId('watch-completion-threshold-setting'),
    ).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
