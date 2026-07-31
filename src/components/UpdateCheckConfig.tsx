'use client';

import { CheckCircle, LoaderCircle, Save, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AdminConfig } from '@/lib/admin.types';
import { getNextRun, validateCronExpression } from '@/lib/scheduler/cron-utils';
import {
  SCHEDULER_TIMEZONE_PRESETS,
  validateTimezone,
} from '@/lib/scheduler/timezone-utils';

interface UpdateCheckSettings {
  enabled: boolean;
  schedulerEnabled: boolean;
  cronExpression: string;
  timezone: string;
  logRetentionCount: number;
  batchSize: number;
  maxUsers: number;
  maxFollowPerUser: number;
}

const DEFAULT_SETTINGS: UpdateCheckSettings = {
  enabled: false,
  schedulerEnabled: true,
  cronExpression: '*/30 * * * *',
  timezone: 'UTC',
  logRetentionCount: 200,
  batchSize: 100,
  maxUsers: 1000,
  maxFollowPerUser: 100,
};

const CRON_PRESETS = [
  { value: '*/5 * * * *', label: '每5分钟' },
  { value: '*/10 * * * *', label: '每10分钟' },
  { value: '*/30 * * * *', label: '每30分钟' },
  { value: '0 * * * *', label: '每小时' },
  { value: '0 0 * * *', label: '每天凌晨' },
  { value: '0 12 * * *', label: '每天中午' },
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
      schedulerEnabled:
        systemConfig?.updateCheckSchedulerEnabled ??
        DEFAULT_SETTINGS.schedulerEnabled,
      cronExpression:
        systemConfig?.updateCheckCronExpression ??
        DEFAULT_SETTINGS.cronExpression,
      timezone: systemConfig?.updateCheckTimezone ?? DEFAULT_SETTINGS.timezone,
      logRetentionCount:
        systemConfig?.updateCheckLogRetentionCount ??
        DEFAULT_SETTINGS.logRetentionCount,
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
    if (!validateCronExpression(settings.cronExpression)) {
      setMessage({ type: 'error', text: 'Cron 表达式格式无效' });
      return;
    }
    if (!validateTimezone(settings.timezone)) {
      setMessage({ type: 'error', text: '时区格式无效' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      if (!adminConfig) throw new Error('管理员配置尚未加载');
      const updatedConfig: AdminConfig = {
        ...adminConfig,
        SystemConfig: {
          ...adminConfig.SystemConfig,
          updateCheckBackendEnabled: settings.enabled,
          updateCheckSchedulerEnabled: settings.schedulerEnabled,
          updateCheckCronExpression: settings.cronExpression,
          updateCheckTimezone: settings.timezone,
          updateCheckLogRetentionCount: settings.logRetentionCount,
          updateCheckBatchSize: settings.batchSize,
          updateCheckMaxUsers: settings.maxUsers,
          updateCheckMaxFollowPerUser: settings.maxFollowPerUser,
        },
      };
      const response = await fetch('/api/admin/settings/update-check', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemConfig: updatedConfig.SystemConfig }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存追更配置失败');
      requestSequence.current += 1;
      applyAdminConfig({
        ...adminConfig,
        SystemConfig: data.SystemConfig ?? updatedConfig.SystemConfig,
      });
      setMessage({
        type: 'success',
        text: `追更后台计算配置已保存，${nextRunText(
          settings.cronExpression,
          settings.timezone,
        )}`,
      });
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

      <div className='grid gap-4 md:grid-cols-2'>
        <SwitchSetting
          label='追更系统'
          checked={settings.enabled}
          disabled={!canEditSystemConfig}
          description={
            settings.enabled
              ? '系统默认启用。仅 owner 和已授权用户生成后台追更结果。'
              : '系统默认关闭。用户追更配置保留，不会被重置。'
          }
          onChange={() =>
            setSettings((current) => ({
              ...current,
              enabled: !current.enabled,
            }))
          }
        />
        <SwitchSetting
          label='自动调度'
          checked={settings.schedulerEnabled}
          disabled={!canEditSystemConfig}
          description={
            settings.schedulerEnabled
              ? '按系统默认 Cron 唤醒，用户自定义 Cron 仍优先。'
              : '暂停系统自动调度，保留所有用户级追更设置。'
          }
          onChange={() =>
            setSettings((current) => ({
              ...current,
              schedulerEnabled: !current.schedulerEnabled,
            }))
          }
        />
      </div>

      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        <label className='block'>
          <span className='mb-1.5 block text-sm text-gray-700 dark:text-gray-300'>
            Cron 预设
          </span>
          <select
            value={
              CRON_PRESETS.some(
                (option) => option.value === settings.cronExpression,
              )
                ? settings.cronExpression
                : ''
            }
            onChange={(event) =>
              event.target.value &&
              setSettings((current) => ({
                ...current,
                cronExpression: event.target.value,
              }))
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          >
            <option value=''>自定义 Cron</option>
            {CRON_PRESETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className='block'>
          <span className='mb-1.5 block text-sm text-gray-700 dark:text-gray-300'>
            Linux Cron 表达式
          </span>
          <input
            aria-label='Linux Cron 表达式'
            value={settings.cronExpression}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                cronExpression: event.target.value,
              }))
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
          <span className='mt-1 block text-xs text-gray-500'>
            {nextRunText(settings.cronExpression, settings.timezone)}
          </span>
        </label>
        <label className='block'>
          <span className='mb-1.5 block text-sm text-gray-700 dark:text-gray-300'>
            默认时区
          </span>
          <select
            aria-label='默认时区'
            value={
              SCHEDULER_TIMEZONE_PRESETS.includes(
                settings.timezone as (typeof SCHEDULER_TIMEZONE_PRESETS)[number],
              )
                ? settings.timezone
                : ''
            }
            onChange={(event) =>
              event.target.value &&
              setSettings((current) => ({
                ...current,
                timezone: event.target.value,
              }))
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          >
            <option value=''>自定义时区</option>
            {SCHEDULER_TIMEZONE_PRESETS.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </select>
        </label>
        <label className='block'>
          <span className='mb-1.5 block text-sm text-gray-700 dark:text-gray-300'>
            IANA 时区
          </span>
          <input
            aria-label='IANA 时区'
            value={settings.timezone}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                timezone: event.target.value,
              }))
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </label>
        <NumberSetting
          label='日志留存数量'
          value={settings.logRetentionCount}
          min={50}
          max={5000}
          onChange={(logRetentionCount) =>
            setSettings((current) => ({ ...current, logRetentionCount }))
          }
        />
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

function nextRunText(cronExpression: string, timezone: string) {
  if (!validateCronExpression(cronExpression)) return 'Cron 表达式无效';
  if (!validateTimezone(timezone)) return '时区无效';
  const nextRun = getNextRun(cronExpression, timezone);
  return nextRun ? `下次执行：${nextRun.toLocaleString()}` : '无下一次执行时间';
}

function SwitchSetting({
  label,
  checked,
  disabled,
  description,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  description: string;
  onChange: () => void;
}) {
  return (
    <div className='flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700'>
      <div>
        <div className='font-medium text-gray-900 dark:text-gray-100'>
          {label}
        </div>
        <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
          {description}
        </p>
      </div>
      <button
        type='button'
        role='switch'
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          checked
            ? 'bg-green-600 dark:bg-green-600'
            : 'bg-gray-200 dark:bg-gray-700'
        }`}
      >
        <span
          aria-hidden='true'
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
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
