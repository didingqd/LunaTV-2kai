import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { getAdminWatchingUpdateCheckLogs } from '@/lib/api/admin-watching-update-check-logs';
import type { WatchingUpdateCheckLogEntry } from '@/lib/watching-update-check-log-types';

import WatchingUpdateCheckLogViewer from './WatchingUpdateCheckLogViewer';

const originalFetch = global.fetch;

function logEntry(
  overrides: Partial<WatchingUpdateCheckLogEntry> = {},
): WatchingUpdateCheckLogEntry {
  return {
    id: 'log-1',
    source: 'cron',
    operation: 'scheduled-check',
    request: {
      method: 'POST',
      path: '/api/cron/update-checks',
      userId: 'alice',
      body: { followIds: ['follow-1'] },
      client: {
        platform: 'web',
        version: '1.0.0',
        device: 'desktop',
      },
    },
    execution: {
      startedAt: 1785377400000,
      endedAt: 1785377400123,
      durationMs: 123,
      success: true,
    },
    result: {
      checkedCount: 2,
      successCount: 2,
      failureCount: 0,
      updateFoundCount: 1,
      updates: [
        {
          resourceId: 'source-a/video-1',
          title: 'Demo A',
          oldEpisode: 10,
          newEpisode: 12,
          source: 'source-a',
        },
      ],
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

function mockFetch(data: unknown, status = 200) {
  const fetchMock = jest.fn().mockResolvedValue(jsonResponse(data, status));
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
  return fetchMock;
}

describe('WatchingUpdateCheckLogViewer', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
    jest.restoreAllMocks();
  });

  it('loads and displays watching update check logs', async () => {
    mockFetch({ logs: [logEntry()], total: 1 });

    render(<WatchingUpdateCheckLogViewer />);

    expect(await screen.findByText('alice')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('cron')).toBeInTheDocument();
    expect(within(table).getByText('scheduled-check')).toBeInTheDocument();
    expect(screen.getByText('123 ms')).toBeInTheDocument();
  });

  it('sends source as a backend query parameter', async () => {
    const fetchMock = mockFetch({ logs: [], total: 0 });

    await getAdminWatchingUpdateCheckLogs({ limit: 200, source: 'app' });

    expect(String(fetchMock.mock.calls[0][0])).toContain('source=app');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('operation=');
  });

  it('sends userId as a backend query parameter', async () => {
    const fetchMock = mockFetch({ logs: [], total: 0 });

    await getAdminWatchingUpdateCheckLogs({ limit: 200, userId: 'bob' });

    expect(String(fetchMock.mock.calls[0][0])).toContain('userId=bob');
  });

  it('filters operation on the frontend', async () => {
    const fetchMock = mockFetch({
      logs: [
        logEntry({ id: 'log-check', operation: 'check' }),
        logEntry({
          id: 'log-sync',
          source: 'app',
          operation: 'sync',
          request: {
            ...logEntry().request,
            userId: 'sync-user',
          },
        }),
      ],
      total: 2,
    });

    render(<WatchingUpdateCheckLogViewer />);

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('sync-user')).toBeInTheDocument();

    const operationSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(operationSelect, { target: { value: 'sync' } });

    expect(screen.queryByText('alice')).not.toBeInTheDocument();
    expect(screen.getByText('sync-user')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('operation=');
  });

  it('opens a details modal for a selected log', async () => {
    mockFetch({ logs: [logEntry()], total: 1 });

    render(<WatchingUpdateCheckLogViewer />);

    await screen.findByText('alice');
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('/api/cron/update-checks')).toBeInTheDocument();
    expect(screen.getByText('Demo A')).toBeInTheDocument();
    expect(screen.getByText('source-a/video-1')).toBeInTheDocument();
  });

  it('shows an error message for 403 responses', async () => {
    mockFetch({ error: 'Unauthorized' }, 403);

    render(<WatchingUpdateCheckLogViewer />);

    expect(
      await screen.findByText(
        (content) => content.includes('无权') || content.includes('鏃犳潈'),
      ),
    ).toBeInTheDocument();
  });
});
