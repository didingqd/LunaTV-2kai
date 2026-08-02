import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import NotificationCenterPage from './NotificationCenterPage';

const originalFetch = global.fetch;

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n-1',
    userId: 'alice',
    type: 'test.event',
    title: '《Demo》发现更新',
    content: 'Source A 已从 10 集更新到 12 集',
    createdAt: Date.parse('2026-07-30T12:00:00.000Z'),
    payload: { source: 'source-a', resourceId: 'video-1' },
    read: false,
    readAt: null,
    ...overrides,
  };
}

function listResponse(items = [notification()]) {
  return {
    notifications: items,
    total: items.length,
    unread: items.filter((item) => !item.read).length,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function setFetch(fetchMock: jest.Mock) {
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
}

describe('NotificationCenterPage', () => {
  afterEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
    jest.restoreAllMocks();
  });

  it('loads notifications and shows unread count', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(listResponse()));
    setFetch(fetchMock);

    render(<NotificationCenterPage />);

    expect(screen.getByText('正在加载通知')).toBeInTheDocument();
    expect(await screen.findByText('通知中心')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText(/共\s*1\s*条通知，\s*1\s*条未读/),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText('《Demo》发现更新').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/user/notifications', {
      cache: 'no-store',
    });
  });

  it('shows an empty state', async () => {
    setFetch(jest.fn().mockResolvedValue(jsonResponse(listResponse([]))));

    render(<NotificationCenterPage />);

    expect(await screen.findByText('暂无通知')).toBeInTheDocument();
  });

  it('renders watching update details with consistent section and episode styles', async () => {
    setFetch(
      jest.fn().mockResolvedValue(
        jsonResponse(
          listResponse([
            notification({
              type: 'watching.update_found',
              title: '更新提醒',
              content:
                '更新提醒\n\n🆕 新更新（1）\n\n测试番剧 A\n12 → 13 集（+1）\n\n✅ 已更新（2）\n\n测试番剧 B\n5 → 6 集（+1）\n\n测试番剧 C\n18 → 20 集（+2）',
              payload: {
                newUpdates: [
                  {
                    followId: 'a',
                    title: '测试番剧 A',
                    fromEpisode: 12,
                    toEpisode: 13,
                  },
                ],
                updated: [
                  {
                    followId: 'b',
                    title: '测试番剧 B',
                    fromEpisode: 5,
                    toEpisode: 6,
                  },
                  {
                    followId: 'c',
                    title: '测试番剧 C',
                    fromEpisode: 18,
                    toEpisode: 20,
                  },
                ],
                displayTime: '2026-08-02 12:30:01',
              },
            }),
          ]),
        ),
      ),
    );

    render(<NotificationCenterPage />);

    expect(await screen.findByText('新更新（1）')).toBeInTheDocument();
    expect(screen.getByText('已更新（2）')).toBeInTheDocument();
    expect(screen.getByText('12 → 13 集（+1）')).toBeInTheDocument();
    expect(screen.getByText('5 → 6 集（+1）')).toBeInTheDocument();
    expect(screen.getByText('18 → 20 集（+2）')).toBeInTheDocument();
    expect(screen.getByText('2026-08-02 12:30:01')).toBeInTheDocument();
  });

  it('marks a notification read when selected', async () => {
    const updated = notification({
      read: true,
      readAt: Date.parse('2026-07-30T12:05:00.000Z'),
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(listResponse([notification()])))
      .mockResolvedValueOnce(jsonResponse(updated));
    setFetch(fetchMock);

    render(<NotificationCenterPage />);

    const items = await screen.findAllByRole('button', {
      name: /《Demo》发现更新/,
    });
    fireEvent.click(items[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/user/notifications/n-1');
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ read: true });
  });

  it('toggles read state from the detail action', async () => {
    const unread = notification({ read: true, readAt: 2000 });
    const updated = notification({ read: false, readAt: null });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(listResponse([unread])))
      .mockResolvedValueOnce(jsonResponse(updated));
    setFetch(fetchMock);

    render(<NotificationCenterPage />);

    fireEvent.click(await screen.findByRole('button', { name: '标记未读' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      read: false,
    });
  });

  it('deletes a single notification', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(listResponse([notification()])))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    setFetch(fetchMock);

    render(<NotificationCenterPage />);

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/user/notifications/n-1');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('clears all notifications', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(listResponse([notification()])))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    setFetch(fetchMock);

    render(<NotificationCenterPage />);

    fireEvent.click(await screen.findByRole('button', { name: '清空全部' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/user/notifications');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('shows API errors', async () => {
    setFetch(
      jest
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'server failed' }, 500)),
    );

    render(<NotificationCenterPage />);

    expect(await screen.findByText('server failed')).toBeInTheDocument();
  });

  it('shows an unauthenticated message', async () => {
    setFetch(jest.fn().mockResolvedValue(jsonResponse({}, 401)));

    render(<NotificationCenterPage />);

    expect(await screen.findByText('请先登录后查看通知')).toBeInTheDocument();
  });
});
