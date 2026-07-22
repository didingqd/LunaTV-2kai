'use client';

import { CheckCircle, LoaderCircle, Save, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UpdateCheckUserAccess {
  userId: string;
  owner: boolean;
  granted: boolean;
  enabled: boolean;
  mode: 'backend' | 'local';
  updatedAt: number | null;
  operator: string | null;
}

interface UpdateCheckSettings {
  enabled: boolean;
  updateCheckCronInterval: number;
  batchSize: number;
  maxUsers: number;
  maxFollowPerUser: number;
  users: UpdateCheckUserAccess[];
}

const DEFAULT_SETTINGS: UpdateCheckSettings = {
  enabled: false,
  updateCheckCronInterval: 30 * 60 * 1000,
  batchSize: 100,
  maxUsers: 1000,
  maxFollowPerUser: 100,
  users: [],
};

const CRON_INTERVAL_OPTIONS = [
  { value: 30 * 60 * 1000, label: '30 分钟' },
  { value: 60 * 60 * 1000, label: '1 小时' },
  { value: 6 * 60 * 60 * 1000, label: '6 小时' },
  { value: 12 * 60 * 60 * 1000, label: '12 小时' },
  { value: 24 * 60 * 60 * 1000, label: '24 小时' },
] as const;

export default function UpdateCheckConfig() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const requestSequence = useRef(0);

  const applyServerSettings = useCallback(
    (data: Partial<UpdateCheckSettings>) => {
      setSettings({
        ...DEFAULT_SETTINGS,
        ...data,
        users: Array.isArray(data.users) ? data.users : [],
      });
    },
    [],
  );

  const loadSettings = useCallback(
    async (showLoading = true) => {
      const requestId = ++requestSequence.current;
      if (showLoading) setLoading(true);
      try {
        const response = await fetch('/api/admin/settings/update-check', {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '读取追更配置失败');
        if (requestId === requestSequence.current) applyServerSettings(data);
      } catch (error) {
        if (requestId === requestSequence.current) {
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : '读取追更配置失败',
          });
        }
      } finally {
        if (showLoading && requestId === requestSequence.current) {
          setLoading(false);
        }
      }
    },
    [applyServerSettings],
  );

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/settings/update-check', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: settings.enabled,
          updateCheckCronInterval: settings.updateCheckCronInterval,
          batchSize: settings.batchSize,
          maxUsers: settings.maxUsers,
          maxFollowPerUser: settings.maxFollowPerUser,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存追更配置失败');
      requestSequence.current += 1;
      applyServerSettings(data);
      setMessage({ type: 'success', text: '追更后台计算配置已保存' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存追更配置失败',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateUserPermission = async (userId: string, enabled: boolean) => {
    setUpdatingUser(userId);
    setMessage(null);
    try {
      const response = await fetch(
        '/api/admin/settings/update-check/permissions',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, enabled }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '更新用户授权失败');
      setMessage({
        type: 'success',
        text: enabled ? `已授权 ${userId}` : `已关闭 ${userId} 的后端计算`,
      });
      await loadSettings(false);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '更新用户授权失败',
      });
    } finally {
      setUpdatingUser(null);
    }
  };

  if (loading) {
    return (
      <div className='flex items-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400'>
        <LoaderCircle className='h-4 w-4 animate-spin' />
        正在读取追更配置
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {message && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className='h-4 w-4 shrink-0' />
          ) : (
            <XCircle className='h-4 w-4 shrink-0' />
          )}
          {message.text}
        </div>
      )}

      <div className='flex items-center justify-between gap-4'>
        <div>
          <div className='font-medium text-gray-900 dark:text-gray-100'>
            后端追更计算
          </div>
          <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
            {settings.enabled
              ? '已启用。仅 owner 和已授权用户生成后台追更结果。'
              : '已关闭。所有用户使用本地计算，服务器不执行追更任务。'}
          </p>
        </div>
        <button
          type='button'
          role='switch'
          aria-checked={settings.enabled}
          aria-label='后端追更计算'
          onClick={() =>
            setSettings((current) => ({
              ...current,
              enabled: !current.enabled,
            }))
          }
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            settings.enabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
              settings.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        <label className='block'>
          <span className='mb-1.5 block text-sm text-gray-700 dark:text-gray-300'>
            Cron 调度周期
          </span>
          <select
            value={settings.updateCheckCronInterval}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                updateCheckCronInterval: Number(event.target.value),
              }))
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          >
            {CRON_INTERVAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <NumberSetting
          label='单次任务数'
          value={settings.batchSize}
          min={1}
          max={500}
          onChange={(batchSize) =>
            setSettings((current) => ({ ...current, batchSize }))
          }
        />
        <NumberSetting
          label='单次最大用户数'
          value={settings.maxUsers}
          min={1}
          max={10000}
          onChange={(maxUsers) =>
            setSettings((current) => ({ ...current, maxUsers }))
          }
        />
        <NumberSetting
          label='单用户最大追更数'
          value={settings.maxFollowPerUser}
          min={1}
          max={1000}
          onChange={(maxFollowPerUser) =>
            setSettings((current) => ({ ...current, maxFollowPerUser }))
          }
        />
      </div>

      <button
        type='button'
        disabled={saving}
        onClick={saveSettings}
        className='inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
      >
        {saving ? (
          <LoaderCircle className='h-4 w-4 animate-spin' />
        ) : (
          <Save className='h-4 w-4' />
        )}
        保存配置
      </button>

      <div>
        <h4 className='font-medium text-gray-900 dark:text-gray-100'>
          用户授权
        </h4>
        <div className='mt-3 overflow-x-auto'>
          <table className='w-full min-w-[560px] text-left text-sm'>
            <thead className='border-b border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'>
              <tr>
                <th className='px-3 py-2 font-medium'>用户名</th>
                <th className='px-3 py-2 font-medium'>当前状态</th>
                <th className='px-3 py-2 text-right font-medium'>操作</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-100 dark:divide-gray-700/70'>
              {settings.users.map((user) => (
                <tr key={user.userId}>
                  <td className='px-3 py-3 text-gray-900 dark:text-gray-100'>
                    {user.userId}
                    {user.owner && (
                      <span className='ml-2 text-xs text-gray-500'>
                        (owner)
                      </span>
                    )}
                  </td>
                  <td className='px-3 py-3'>
                    <span
                      className={
                        user.enabled
                          ? 'text-green-700 dark:text-green-400'
                          : 'text-gray-600 dark:text-gray-400'
                      }
                    >
                      {user.enabled ? '后端计算' : '本地计算'}
                    </span>
                    {!settings.enabled && user.granted && !user.owner && (
                      <span className='ml-2 text-xs text-gray-500'>已授权</span>
                    )}
                  </td>
                  <td className='px-3 py-3 text-right'>
                    {user.owner ? (
                      <span className='text-xs text-gray-500'>跟随总开关</span>
                    ) : (
                      <button
                        type='button'
                        disabled={updatingUser === user.userId}
                        onClick={() =>
                          updateUserPermission(user.userId, !user.granted)
                        }
                        className={`rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                          user.granted
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-green-600 hover:bg-green-700'
                        }`}
                      >
                        {updatingUser === user.userId
                          ? '处理中'
                          : user.granted
                            ? '关闭后端计算'
                            : '开启后端计算'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className='block'>
      <span className='mb-1.5 block text-sm text-gray-700 dark:text-gray-300'>
        {label}
      </span>
      <input
        type='number'
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
      />
      <span className='mt-1 block text-xs text-gray-500'>
        范围 {min} - {max}
      </span>
    </label>
  );
}
