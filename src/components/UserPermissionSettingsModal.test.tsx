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
      value: jest.fn(),
    });
  });

  afterEach(() => {
    delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch;
  });

  it('renders five tabs and keeps tabs horizontally scrollable for narrow screens', async () => {
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
    expect(
      screen.getByRole('tab', { name: '追更系统控制' }),
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
    expect(screen.queryByText('追更后端计算')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /AI 推荐/ })).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /YouTube 搜索/ }),
    ).not.toBeChecked();
  });

  it('keeps update-check permission out of special features', async () => {
    const fetchMock = global.fetch as jest.Mock;
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    render(
      <UserPermissionSettingsModal
        user={user}
        userGroups={[]}
        sources={sources}
        systemUpdateCheckEnabled={false}
        onClose={jest.fn()}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(await screen.findByRole('tab', { name: '特殊功能权限' }));
    expect(
      screen.queryByRole('checkbox', { name: /追更后端计算/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存特殊功能' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/user');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps admin trigger link management open after saving', async () => {
    const fetchMock = global.fetch as jest.Mock;
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(watchingUpdateConfigResponse({ allowTriggerLink: false })),
      )
      .mockResolvedValueOnce(jsonResponse(triggerLinkResponse()))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse(watchingUpdateConfigResponse({ allowTriggerLink: true })),
      )
      .mockResolvedValueOnce(
        jsonResponse(watchingUpdateConfigResponse({ allowTriggerLink: true })),
      )
      .mockResolvedValueOnce(jsonResponse(triggerLinkResponse()));

    render(
      <UserPermissionSettingsModal
        user={user}
        userGroups={[]}
        sources={sources}
        systemUpdateCheckEnabled={true}
        onClose={jest.fn()}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(await screen.findByRole('tab', { name: '追更系统控制' }));
    fireEvent.click(
      await screen.findByRole('switch', { name: '允许触发链接' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存全部设置' }));

    expect(await screen.findByText('追更系统设置已保存')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(
      screen.getByRole('tabpanel', { name: '追更系统控制' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '允许触发链接' })).toBeChecked();
  });
});

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function watchingUpdateConfigResponse({
  allowTriggerLink,
}: {
  allowTriggerLink: boolean;
}) {
  return {
    username: user.username,
    permission: {
      enabled: true,
      allowCustomSchedule: true,
      allowTriggerLink,
    },
    userConfig: null,
    effective: {
      enabled: true,
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
    },
    sources: {
      cron: 'system',
      timezone: 'system',
    },
    triggerLinkAccessControl: {
      enabled: true,
      ipLimit: {
        enabled: true,
        windowMinutes: 60,
        maxAttempts: 5,
        blockMinutes: 30,
      },
      userLimit: {
        enabled: true,
        windowMinutes: 1440,
        maxAttempts: 20,
      },
      autoDisable: {
        enabled: true,
        violationThreshold: 3,
        violationWindowMinutes: 60,
      },
    },
  };
}

function triggerLinkResponse() {
  return {
    username: user.username,
    permission: {
      allowTriggerLink: true,
    },
    triggerLink: {
      enabled: true,
      disabledReason: null,
      disabledAt: null,
      disabledSource: null,
      createdAt: 1000,
      rotatedAt: 1000,
      expiresAt: null,
      hasToken: true,
      tokenConfigured: true,
      expired: false,
      tokenId: 'token-1',
      maskedToken: 'toke****cret',
      canRevealToken: true,
      triggerLink:
        'http://localhost/api/update-check-trigger?token=toke****cret',
    },
  };
}
