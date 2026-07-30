'use client';

import {
  CheckCircle,
  LoaderCircle,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { UserWatchingUpdateConfig } from '@/lib/admin.types';
import { validateCronExpression } from '@/lib/scheduler/cron-utils';
import { validateTimezone } from '@/lib/scheduler/timezone-utils';

type UserRole = 'user' | 'admin' | 'owner';
type ConfigMode = 'inherit' | 'custom';
type ConfigField = 'cronExpression' | 'timezone' | 'logRetentionCount';
type ConfigSource = 'user' | 'system' | 'default';

interface UserWatchingUpdateConfigResponse {
  username: string;
  permission: boolean;
  override: UserWatchingUpdateConfig | null;
  effective: {
    enabled: boolean;
    cronExpression: string;
    timezone: string;
    logRetentionCount: number;
  };
  sources: {
    cron: ConfigSource;
    timezone: ConfigSource;
    retention: ConfigSource;
  };
}

interface UserWatchingUpdateConfigPanelProps {
  username: string;
  userRole: UserRole;
  systemUpdateCheckEnabled: boolean;
  onRefresh: () => Promise<void>;
}

const CRON_PRESETS = [
  { label: '每30分钟', value: '*/30 * * * *' },
  { label: '每1小时', value: '0 * * * *' },
  { label: '每6小时', value: '0 */6 * * *' },
  { label: '每12小时', value: '0 */12 * * *' },
  { label: '每24小时', value: '0 0 * * *' },
] as const;

const TIMEZONE_PRESETS = [
  'UTC',
  'Asia/Shanghai',
  'Europe/Berlin',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
] as const;

const SOURCE_LABELS: Record<ConfigSource, string> = {
  user: '用户自定义',
  system: '系统配置',
  default: '默认值',
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '追更配置请求失败');
  return data as UserWatchingUpdateConfigResponse;
}

export default function UserWatchingUpdateConfigPanel({
  username,
  userRole,
  systemUpdateCheckEnabled,
  onRefresh,
}: UserWatchingUpdateConfigPanelProps) {
  const [config, setConfig] = useState<UserWatchingUpdateConfigResponse | null>(
    null,
  );
  const [permission, setPermission] = useState(false);
  const [cronMode, setCronMode] = useState<ConfigMode>('inherit');
  const [cronExpression, setCronExpression] = useState('*/30 * * * *');
  const [timezoneMode, setTimezoneMode] = useState<ConfigMode>('inherit');
  const [timezone, setTimezone] = useState('UTC');
  const [retentionMode, setRetentionMode] = useState<ConfigMode>('inherit');
  const [retentionCount, setRetentionCount] = useState('200');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ConfigField | 'permission' | null>(null);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const requestSequence = useRef(0);

  const applyConfig = useCallback(
    (next: UserWatchingUpdateConfigResponse, resetDrafts: boolean) => {
      setConfig(next);
      setPermission(next.permission);
      if (!resetDrafts) return;

      setCronMode(
        next.override?.cronExpression === undefined ? 'inherit' : 'custom',
      );
      setCronExpression(
        next.override?.cronExpression ?? next.effective.cronExpression,
      );
      setTimezoneMode(
        next.override?.timezone === undefined ? 'inherit' : 'custom',
      );
      setTimezone(next.override?.timezone ?? next.effective.timezone);
      setRetentionMode(
        next.override?.logRetentionCount === undefined ? 'inherit' : 'custom',
      );
      setRetentionCount(
        String(
          next.override?.logRetentionCount ?? next.effective.logRetentionCount,
        ),
      );
    },
    [],
  );

  const loadConfig = useCallback(
    async (resetDrafts: boolean) => {
      const requestId = ++requestSequence.current;
      try {
        const response = await fetch(
          `/api/admin/watching-updates/users/${encodeURIComponent(username)}/config`,
          { cache: 'no-store' },
        );
        const data = await readResponse(response);
        if (requestId === requestSequence.current) {
          applyConfig(data, resetDrafts);
        }
      } catch (error) {
        if (requestId === requestSequence.current) {
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : '读取追更配置失败',
          });
        }
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    },
    [applyConfig, username],
  );

  useEffect(() => {
    setLoading(true);
    setMessage(null);
    void loadConfig(true);
  }, [loadConfig]);

  const updateSavedField = (
    next: UserWatchingUpdateConfigResponse,
    field: ConfigField,
  ) => {
    applyConfig(next, false);
    if (field === 'cronExpression') {
      setCronMode(next.override?.cronExpression ? 'custom' : 'inherit');
      setCronExpression(
        next.override?.cronExpression ?? next.effective.cronExpression,
      );
    } else if (field === 'timezone') {
      setTimezoneMode(next.override?.timezone ? 'custom' : 'inherit');
      setTimezone(next.override?.timezone ?? next.effective.timezone);
    } else {
      setRetentionMode(
        next.override?.logRetentionCount === undefined ? 'inherit' : 'custom',
      );
      setRetentionCount(
        String(
          next.override?.logRetentionCount ?? next.effective.logRetentionCount,
        ),
      );
    }
  };

  const saveField = async (field: ConfigField) => {
    const mode =
      field === 'cronExpression'
        ? cronMode
        : field === 'timezone'
          ? timezoneMode
          : retentionMode;
    let value: string | number = '';
    if (mode === 'custom') {
      if (field === 'cronExpression') {
        if (!validateCronExpression(cronExpression)) {
          setMessage({ type: 'error', text: 'Cron Expression 无效' });
          return;
        }
        value = cronExpression;
      } else if (field === 'timezone') {
        if (!validateTimezone(timezone)) {
          setMessage({ type: 'error', text: 'Timezone 无效' });
          return;
        }
        value = timezone;
      } else {
        const parsed = Number(retentionCount);
        if (
          retentionCount.trim() === '' ||
          !Number.isInteger(parsed) ||
          parsed < 50 ||
          parsed > 5000
        ) {
          setMessage({ type: 'error', text: '日志保留数量必须为 50～5000' });
          return;
        }
        value = parsed;
      }
    }

    setSaving(field);
    setMessage(null);
    try {
      const url = `/api/admin/watching-updates/users/${encodeURIComponent(username)}/config`;
      const response = await fetch(url, {
        method: mode === 'custom' ? 'PATCH' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'custom' ? { [field]: value } : { field },
        ),
      });
      const next = await readResponse(response);
      updateSavedField(next, field);
      await onRefresh();
      setMessage({
        type: 'success',
        text: mode === 'custom' ? '用户覆盖已保存' : '已恢复系统继承',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存追更配置失败',
      });
    } finally {
      setSaving(null);
    }
  };

  const savePermission = async () => {
    setSaving('permission');
    setMessage(null);
    try {
      const response = await fetch(
        '/api/admin/settings/update-check/permissions',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: username, enabled: permission }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '更新追更授权失败');
      await onRefresh();
      await loadConfig(false);
      setMessage({ type: 'success', text: '追更授权已保存' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '更新追更授权失败',
      });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className='flex items-center gap-2 py-8 text-sm text-gray-500 dark:text-gray-400'>
        <LoaderCircle className='h-4 w-4 animate-spin' />
        正在加载追更配置
      </div>
    );
  }

  if (!config) {
    return (
      <div className='py-6 text-sm text-red-600 dark:text-red-400'>
        {message?.text || '无法加载追更配置'}
      </div>
    );
  }

  return (
    <div className='space-y-0'>
      {message && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
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

      <section className='flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-5 dark:border-gray-700'>
        <div>
          <div className='flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
            <ShieldCheck className='h-4 w-4 text-blue-600 dark:text-blue-400' />
            追更授权
          </div>
          <p className='mt-1 text-sm text-gray-600 dark:text-gray-400'>
            当前授权状态：
            {userRole === 'owner'
              ? '跟随系统总开关'
              : permission
                ? '开启'
                : '关闭'}
            ，最终状态：{config.effective.enabled ? '启用' : '停用'}
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <button
            type='button'
            role='switch'
            aria-label='追更授权'
            aria-checked={
              userRole === 'owner' ? systemUpdateCheckEnabled : permission
            }
            disabled={userRole === 'owner' || saving === 'permission'}
            onClick={() => setPermission((current) => !current)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
              (userRole === 'owner' ? systemUpdateCheckEnabled : permission)
                ? 'bg-green-600'
                : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                (userRole === 'owner' ? systemUpdateCheckEnabled : permission)
                  ? 'translate-x-5'
                  : 'translate-x-0'
              }`}
            />
          </button>
          {userRole !== 'owner' && (
            <ActionButton
              label='保存授权'
              loading={saving === 'permission'}
              onClick={savePermission}
            />
          )}
        </div>
      </section>

      <StrategySection
        title='Cron'
        effective={config.effective.cronExpression}
        override={config.override?.cronExpression}
        source={config.sources.cron}
        mode={cronMode}
        onModeChange={setCronMode}
        saving={saving === 'cronExpression'}
        onSave={() => saveField('cronExpression')}
      >
        {cronMode === 'custom' && (
          <div className='grid gap-3 sm:grid-cols-2'>
            <label className='block'>
              <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                Cron 预设
              </span>
              <select
                aria-label='Cron 预设'
                value={
                  CRON_PRESETS.some((preset) => preset.value === cronExpression)
                    ? cronExpression
                    : ''
                }
                onChange={(event) => {
                  if (event.target.value) setCronExpression(event.target.value);
                }}
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              >
                <option value=''>自定义表达式</option>
                {CRON_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className='block'>
              <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                Cron Expression
              </span>
              <input
                aria-label='Cron Expression'
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              />
            </label>
          </div>
        )}
      </StrategySection>

      <StrategySection
        title='Timezone'
        effective={config.effective.timezone}
        override={config.override?.timezone}
        source={config.sources.timezone}
        mode={timezoneMode}
        onModeChange={setTimezoneMode}
        saving={saving === 'timezone'}
        onSave={() => saveField('timezone')}
      >
        {timezoneMode === 'custom' && (
          <div className='grid gap-3 sm:grid-cols-2'>
            <label className='block'>
              <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                Timezone 预设
              </span>
              <select
                aria-label='Timezone 预设'
                value={
                  TIMEZONE_PRESETS.includes(
                    timezone as (typeof TIMEZONE_PRESETS)[number],
                  )
                    ? timezone
                    : ''
                }
                onChange={(event) => {
                  if (event.target.value) setTimezone(event.target.value);
                }}
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              >
                <option value=''>自定义时区</option>
                {TIMEZONE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </label>
            <label className='block'>
              <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                IANA Timezone
              </span>
              <input
                aria-label='IANA Timezone'
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              />
            </label>
          </div>
        )}
      </StrategySection>

      <StrategySection
        title='日志保留数量'
        effective={String(config.effective.logRetentionCount)}
        override={
          config.override?.logRetentionCount === undefined
            ? undefined
            : String(config.override.logRetentionCount)
        }
        source={config.sources.retention}
        mode={retentionMode}
        onModeChange={setRetentionMode}
        saving={saving === 'logRetentionCount'}
        onSave={() => saveField('logRetentionCount')}
      >
        {retentionMode === 'custom' && (
          <label className='block max-w-xs'>
            <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
              Log Retention Count
            </span>
            <input
              type='number'
              min={50}
              max={5000}
              step={1}
              aria-label='Log Retention Count'
              value={retentionCount}
              onChange={(event) => setRetentionCount(event.target.value)}
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
          </label>
        )}
      </StrategySection>
    </div>
  );
}

function StrategySection({
  title,
  effective,
  override,
  source,
  mode,
  onModeChange,
  saving,
  onSave,
  children,
}: {
  title: string;
  effective: string;
  override?: string;
  source: ConfigSource;
  mode: ConfigMode;
  onModeChange: (mode: ConfigMode) => void;
  saving: boolean;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className='space-y-4 border-b border-gray-200 py-5 last:border-b-0 dark:border-gray-700'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            {title}
          </h4>
          <div className='mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400'>
            <p>
              当前生效：
              <span className='font-mono text-gray-900 dark:text-gray-100'>
                {effective}
              </span>
            </p>
            <p>
              用户覆盖：
              <span className='font-mono text-gray-900 dark:text-gray-100'>
                {override ?? '未设置'}
              </span>
            </p>
            <p>
              来源：
              <span className='font-medium text-blue-700 dark:text-blue-300'>
                {SOURCE_LABELS[source]}
              </span>
            </p>
          </div>
        </div>
        <div
          role='group'
          aria-label={`${title} 配置模式`}
          className='inline-flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600'
        >
          <button
            type='button'
            aria-pressed={mode === 'inherit'}
            onClick={() => onModeChange('inherit')}
            className={`px-3 py-1.5 text-xs font-medium ${
              mode === 'inherit'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            继承系统
          </button>
          <button
            type='button'
            aria-pressed={mode === 'custom'}
            onClick={() => onModeChange('custom')}
            className={`border-l border-gray-300 px-3 py-1.5 text-xs font-medium dark:border-gray-600 ${
              mode === 'custom'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            自定义
          </button>
        </div>
      </div>
      {children}
      <ActionButton
        label={mode === 'custom' ? `保存 ${title}` : `恢复 ${title} 继承`}
        loading={saving}
        onClick={onSave}
      />
    </section>
  );
}

function ActionButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      disabled={loading}
      onClick={onClick}
      className='inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60'
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
