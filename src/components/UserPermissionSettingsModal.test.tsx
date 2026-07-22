import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { AdminConfig } from '@/lib/admin.types';

import UserPermissionSettingsModal from './UserPermissionSettingsModal';

const user: AdminConfig['UserConfig']['Users'][number] = {
  username: 'alice',
  role: 'user',
};

const sources: AdminConfig['SourceConfig'] = [
  {
    key: 'source-a',
    name: '源 A',
    api: 'https://example.com/api',
    from: 'config',
  },
];

describe('UserPermissionSettingsModal', () => {
  beforeEach(() => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          users: [
            {
              userId: 'alice',
              owner: false,
              granted: false,
              enabled: false,
              mode: 'local',
            },
          ],
        }),
      } as Response),
    });
  });

  afterEach(() => {
    delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch;
  });

  it('renders four tabs and keeps tabs horizontally scrollable for narrow screens', async () => {
    render(
      <UserPermissionSettingsModal
        user={user}
        userGroups={[]}
        sources={sources}
        systemUpdateCheckEnabled={false}
        onClose={jest.fn()}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      await screen.findByRole('tab', { name: '用户组' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '采集源' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'TVBox Token' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: '特殊功能权限' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('user-permission-tabs')).toHaveClass(
      'overflow-x-auto',
    );
  });

  it('switches content without leaving the modal or adding a page layer', async () => {
    render(
      <UserPermissionSettingsModal
        user={user}
        userGroups={[]}
        sources={sources}
        systemUpdateCheckEnabled={true}
        onClose={jest.fn()}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(await screen.findByRole('tab', { name: '特殊功能权限' }));
    expect(
      screen.getByRole('tabpanel', { name: '特殊功能权限' }),
    ).toBeInTheDocument();
    expect(screen.getByText('AI 推荐')).toBeInTheDocument();
    expect(screen.getByText('YouTube 搜索')).toBeInTheDocument();
    expect(screen.getByText('成人内容显示')).toBeInTheDocument();
    expect(screen.getByText('追更后端计算')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /AI 推荐/ })).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /YouTube 搜索/ }),
    ).not.toBeChecked();
    await waitFor(() =>
      expect(screen.getByText(/系统总开关已开启/)).toBeInTheDocument(),
    );
  });

  it('keeps the effective update-check mode local when the system switch is off', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        users: [
          {
            userId: 'alice',
            owner: false,
            granted: false,
            enabled: false,
            mode: 'local',
          },
        ],
      }),
    } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permission: { userId: 'alice', enabled: true } }),
    } as Response);

    render(
      <UserPermissionSettingsModal
        user={user}
        userGroups={[]}
        sources={sources}
        systemUpdateCheckEnabled={false}
        onClose={jest.fn()}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(await screen.findByRole('tab', { name: '特殊功能权限' }));
    fireEvent.click(await screen.findByRole('switch'));

    await waitFor(() =>
      expect(
        screen.getByText(/当前状态：已授权，实际模式：本地计算/),
      ).toBeInTheDocument(),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      userId: 'alice',
      enabled: true,
    });
  });
});
