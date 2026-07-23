'use client';

import { CheckCircle, LoaderCircle, Save, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AdminConfig } from '@/lib/admin.types';

interface UpdateCheckSettings {
  enabled: boolean;
  updateCheckCronInterval: number;
  batchSize: number;
  maxUsers: number;
  maxFollowPerUser: number;
}

const DEFAULT_SETTINGS: UpdateCheckSettings = {
  enabled: false,
  updateCheckCronInterval: 30 * 60 * 1000,
  batchSize: 100,
  maxUsers: 1000,
  maxFollowPerUser: 100,
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
  const [adminConfig, setAdminConfig] = useState<AdminConfig | null>(null);
  const [canEditSystemConfig, setCanEditSystemConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const requestSequence = useRef(0);

  const applyAdminConfig = useCallback((config: AdminConfig, role?: string) => {
    const systemConfig = config.SystemConfig;
    const enabled = systemConfig?.updateCheckBackendEnabled === true;
    setAdminConfig(config);
    if (role) setCanEditSystemConfig(role === 'owner');
    setSettings({
      enabled,
      updateCheckCronInterval:
        systemConfig?.updateCheckCronInterval ??
        DEFAULT_SETTINGS.updateCheckCronInterval,
      batchSize:
        systemConfig?.updateCheckBatchSize ?? DEFAULT_SETTINGS.batchSize,
      maxUsers: systemConfig?.updateCheckMaxUsers ?? DEFAULT_SETTINGS.maxUsers,
      maxFollowPerUser:
        systemConfig?.updateCheckMaxFollowPerUser ??
        DEFAULT_SETTINGS.maxFollowPerUser,
    });
  }, []);

  const loadSettings = useCallback(
    async (showLoading = true) => {
      const requestId = ++requestSequence.current;
      if (showLoading) setLoading(true);
      try {
        const response = await fetch('/api/admin/config', {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '读取追更配置失败');
        if (requestId === requestSequence.current) {
          applyAdminConfig(data.Config, data.Role);
        }
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
    [applyAdminConfig],
  );

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (!adminConfig) throw new Error('管理员配置尚未加载');
      const updatedConfig: AdminConfig = {
        ...adminConfig,
        SystemConfig: {
          updateCheckBackendEnabled: settings.enabled,
          updateCheckCronInterval: settings.updateCheckCronInterval,
          updateCheckBatchSize: settings.batchSize,
          updateCheckMaxUsers: settings.maxUsers,
          updateCheckMaxFollowPerUser: settings.maxFollowPerUser,
        },
      };
      const response = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存追更配置失败');
      requestSequence.current += 1;
      applyAdminConfig(data.Config ?? updatedConfig);
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
          disabled={!canEditSystemConfig}
          onClick={() =>
            setSettings((current) => ({
              ...current,
              enabled: !current.enabled,
            }))
          }
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
            settings.enabled
              ? 'bg-green-600 dark:bg-green-600'
              : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <span
            aria-hidden='true'
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
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
        disabled={saving || !canEditSystemConfig}
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
