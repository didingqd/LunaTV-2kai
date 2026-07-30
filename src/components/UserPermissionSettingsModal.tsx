'use client';

import { KeyRound, LoaderCircle, Save, Settings, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { AdminConfig } from '@/lib/admin.types';

import UserWatchingUpdateConfigPanel from './UserWatchingUpdateConfigPanel';

type User = AdminConfig['UserConfig']['Users'][number];
type Source = AdminConfig['SourceConfig'][number];
type UserGroup = NonNullable<AdminConfig['UserConfig']['Tags']>[number];
type Tab = 'groups' | 'sources' | 'tvbox' | 'special' | 'watching-update';

interface UserPermissionSettingsModalProps {
  user: User;
  userGroups: UserGroup[];
  sources: Source[];
  systemUpdateCheckEnabled: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'groups', label: '用户组' },
  { id: 'sources', label: '采集源' },
  { id: 'tvbox', label: 'TVBox Token' },
  { id: 'special', label: '特殊功能权限' },
  { id: 'watching-update', label: '追更系统控制' },
];

const featureLabels = [
  {
    key: 'ai-recommend',
    label: 'AI 推荐',
    description: '允许使用 AI 推荐功能。',
  },
  {
    key: 'youtube-search',
    label: 'YouTube 搜索',
    description: '允许搜索和推荐 YouTube 视频。',
  },
] as const;

export default function UserPermissionSettingsModal({
  user,
  userGroups,
  sources,
  systemUpdateCheckEnabled,
  onClose,
  onRefresh,
}: UserPermissionSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('groups');
  const [selectedGroups, setSelectedGroups] = useState<string[]>(
    user.tags || [],
  );
  const [selectedAdultContent, setSelectedAdultContent] = useState(
    user.showAdultContent === true,
  );
  const [selectedSources, setSelectedSources] = useState<string[]>(() => {
    const inherited = (user.tags || []).flatMap(
      (tagName) =>
        userGroups.find((group) => group.name === tagName)?.enabledApis || [],
    );
    return [...new Set([...(user.enabledApis || []), ...inherited])];
  });
  const [tvboxToken, setTvboxToken] = useState(user.tvboxToken);
  const [tvboxSources, setTvboxSources] = useState<string[]>(
    user.tvboxEnabledSources || [],
  );
  const [saving, setSaving] = useState<Tab | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const availableSources = useMemo(
    () => sources.filter((source) => !source.disabled),
    [sources],
  );

  const request = async (url: string, init: RequestInit, success: string) => {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '保存失败');
    await onRefresh();
    setMessage(success);
  };

  const saveGroups = async () => {
    setSaving('groups');
    setMessage(null);
    try {
      await request(
        '/api/admin/user',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: user.username,
            action: 'updateUserGroups',
            userGroups: selectedGroups,
          }),
        },
        '用户组配置已保存',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存用户组失败');
    } finally {
      setSaving(null);
    }
  };

  const saveSources = async () => {
    setSaving('sources');
    setMessage(null);
    try {
      await request(
        '/api/admin/user',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: user.username,
            action: 'updateUserApis',
            enabledApis: selectedSources,
            showAdultContent: selectedAdultContent,
          }),
        },
        '采集源配置已保存',
      );
      setMessage('特殊功能权限已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存采集源配置失败');
    } finally {
      setSaving(null);
    }
  };

  const saveTvbox = async (regenerateToken: boolean) => {
    setSaving('tvbox');
    setMessage(null);
    try {
      const response = await fetch('/api/admin/user-tvbox-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          tvboxEnabledSources: tvboxSources,
          regenerateToken,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '保存 TVBox Token 失败');
      setTvboxToken(data.token || tvboxToken);
      await onRefresh();
      setMessage(regenerateToken ? 'TVBox Token 已生成' : 'TVBox 配置已保存');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '保存 TVBox 配置失败',
      );
    } finally {
      setSaving(null);
    }
  };

  const deleteTvbox = async () => {
    if (!window.confirm(`确定要删除用户 ${user.username} 的 TVBox Token 吗？`))
      return;
    setSaving('tvbox');
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/user-tvbox-token?username=${encodeURIComponent(user.username)}`,
        { method: 'DELETE' },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '删除 TVBox Token 失败');
      setTvboxToken(undefined);
      setTvboxSources([]);
      await onRefresh();
      setMessage('TVBox Token 已删除');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '删除 TVBox Token 失败',
      );
    } finally {
      setSaving(null);
    }
  };

  const toggleSource = (key: string) => {
    setSelectedSources((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  const toggleTvboxSource = (key: string) => {
    setTvboxSources((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      onClick={onClose}
    >
      <div
        className='flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='flex items-center justify-between border-b border-gray-200 p-5 dark:border-gray-700'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            权限设置 - {user.username}
          </h3>
          <button
            type='button'
            aria-label='关闭权限设置'
            onClick={onClose}
            className='rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div
          role='tablist'
          aria-label='用户权限设置栏目'
          data-testid='user-permission-tabs'
          className='flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 px-4 pt-3 dark:border-gray-700'
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type='button'
              role='tab'
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto p-5'>
          {message && (
            <div className='mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300'>
              {message}
            </div>
          )}

          {activeTab === 'groups' && (
            <section role='tabpanel' aria-label='用户组' className='space-y-4'>
              <p className='text-sm text-gray-600 dark:text-gray-400'>
                选择用户组后将复用该组的采集源和特殊功能配置。
              </p>
              <div className='grid gap-3 sm:grid-cols-2'>
                {userGroups.map((group) => (
                  <label
                    key={group.name}
                    className='flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700'
                  >
                    <input
                      type='checkbox'
                      checked={selectedGroups.includes(group.name)}
                      onChange={() =>
                        setSelectedGroups((current) =>
                          current.includes(group.name)
                            ? current.filter((item) => item !== group.name)
                            : [...current, group.name],
                        )
                      }
                      className='h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
                    />
                    <span className='text-sm text-gray-900 dark:text-gray-100'>
                      {group.name}
                    </span>
                  </label>
                ))}
              </div>
              {userGroups.length === 0 && (
                <p className='text-sm text-gray-500 dark:text-gray-400'>
                  暂无用户组
                </p>
              )}
              <SaveButton
                loading={saving === 'groups'}
                onClick={saveGroups}
                label='保存用户组'
              />
            </section>
          )}

          {activeTab === 'sources' && (
            <section role='tabpanel' aria-label='采集源' className='space-y-4'>
              <p className='text-sm text-gray-600 dark:text-gray-400'>
                全不选表示不限制采集源；用户组带来的权限会继续保留。
              </p>
              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                {availableSources.map((source) => (
                  <label
                    key={source.key}
                    className='flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700'
                  >
                    <input
                      type='checkbox'
                      checked={selectedSources.includes(source.key)}
                      onChange={() => toggleSource(source.key)}
                      className='h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
                    />
                    <span className='truncate text-sm text-gray-900 dark:text-gray-100'>
                      {source.name}
                    </span>
                  </label>
                ))}
              </div>
              <SaveButton
                loading={saving === 'sources'}
                onClick={saveSources}
                label='保存采集源'
              />
            </section>
          )}

          {activeTab === 'tvbox' && (
            <section
              role='tabpanel'
              aria-label='TVBox Token'
              className='space-y-5'
            >
              <div>
                <div className='mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300'>
                  <KeyRound className='h-4 w-4 text-blue-600' />
                  当前 Token
                </div>
                <div className='break-all rounded-lg bg-gray-50 p-3 font-mono text-sm text-gray-900 dark:bg-gray-700 dark:text-gray-100'>
                  {tvboxToken || '未设置'}
                </div>
              </div>
              <div className='space-y-3'>
                <div className='flex items-center justify-between text-sm text-gray-700 dark:text-gray-300'>
                  <span>TVBox 可访问采集源</span>
                  <button
                    type='button'
                    onClick={() =>
                      setTvboxSources(
                        tvboxSources.length === availableSources.length
                          ? []
                          : availableSources.map((source) => source.key),
                      )
                    }
                    className='text-xs text-blue-600 hover:text-blue-700'
                  >
                    {tvboxSources.length === availableSources.length
                      ? '取消全选'
                      : '全选'}
                  </button>
                </div>
                <p className='text-xs text-gray-500 dark:text-gray-400'>
                  留空表示可以访问所有源。
                </p>
                <div className='max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700'>
                  {availableSources.map((source) => (
                    <label
                      key={source.key}
                      className='flex cursor-pointer items-center gap-3 border-b border-gray-100 p-3 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700'
                    >
                      <input
                        type='checkbox'
                        checked={tvboxSources.includes(source.key)}
                        onChange={() => toggleTvboxSource(source.key)}
                        className='h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
                      />
                      <span className='truncate text-sm text-gray-900 dark:text-gray-100'>
                        {source.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className='flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-4 dark:border-gray-700'>
                {tvboxToken ? (
                  <button
                    type='button'
                    onClick={deleteTvbox}
                    disabled={saving === 'tvbox'}
                    className='rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20'
                  >
                    删除 Token
                  </button>
                ) : (
                  <span />
                )}
                <div className='flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={() => saveTvbox(true)}
                    disabled={saving === 'tvbox'}
                    className='inline-flex items-center gap-1 rounded-lg bg-blue-100 px-3 py-2 text-sm text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900/40 dark:text-blue-300'
                  >
                    <Settings className='h-4 w-4' />
                    {tvboxToken ? '重新生成' : '生成 Token'}
                  </button>
                  <SaveButton
                    loading={saving === 'tvbox'}
                    onClick={() => saveTvbox(false)}
                    label='保存配置'
                  />
                </div>
              </div>
            </section>
          )}

          {activeTab === 'special' && (
            <section
              role='tabpanel'
              aria-label='特殊功能权限'
              className='space-y-4'
            >
              {featureLabels.map((feature) => (
                <label
                  key={feature.key}
                  className='flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700'
                >
                  <input
                    type='checkbox'
                    checked={selectedSources.includes(feature.key)}
                    onChange={() => toggleSource(feature.key)}
                    className='h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
                  />
                  <span>
                    <span className='block text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {feature.label}
                    </span>
                    <span className='block text-xs text-gray-500 dark:text-gray-400'>
                      {feature.description}
                    </span>
                  </span>
                </label>
              ))}

              <label className='flex cursor-pointer items-center gap-3 rounded-lg border border-red-200 bg-red-50/50 p-4 transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-red-900/10 dark:hover:bg-red-900/20'>
                <input
                  type='checkbox'
                  checked={selectedAdultContent}
                  onChange={(event) =>
                    setSelectedAdultContent(event.target.checked)
                  }
                  className='h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-500'
                />
                <span>
                  <span className='block text-sm font-medium text-gray-900 dark:text-gray-100'>
                    成人内容显示
                  </span>
                  <span className='block text-xs text-gray-500 dark:text-gray-400'>
                    需同时满足站点级别成人内容开关。
                  </span>
                </span>
              </label>

              <SaveButton
                loading={saving === 'sources'}
                onClick={saveSources}
                label='保存特殊功能'
              />
            </section>
          )}

          {activeTab === 'watching-update' && (
            <section role='tabpanel' aria-label='追更系统控制'>
              <UserWatchingUpdateConfigPanel
                username={user.username}
                userRole={user.role}
                systemUpdateCheckEnabled={systemUpdateCheckEnabled}
                onRefresh={onRefresh}
              />
            </section>
          )}
        </div>

        <div className='flex justify-end border-t border-gray-200 p-4 dark:border-gray-700'>
          <button
            type='button'
            onClick={onClose}
            className='rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700'
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveButton({
  loading,
  onClick,
  label,
}: {
  loading: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={loading}
      className='inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
    >
      {loading ? (
        <LoaderCircle className='h-4 w-4 animate-spin' />
      ) : (
        <Save className='h-4 w-4' />
      )}
      {loading ? '保存中...' : label}
    </button>
  );
}
