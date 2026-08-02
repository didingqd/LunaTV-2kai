'use client';

import {
  CheckCircle,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { validateCronExpression } from '@/lib/scheduler/cron-utils';
import { validateTimezone } from '@/lib/scheduler/timezone-utils';

type UserRole = 'user' | 'admin' | 'owner';
type ConfigMode = 'inherit' | 'custom';
type ConfigField = 'cronExpression' | 'timezone';
type ConfigSource = 'user' | 'system' | 'default';
type PanelMode = 'standalone' | 'admin-management';

interface TriggerLinkAccessControlConfig {
  enabled: boolean;
  ipLimit: {
    enabled: boolean;
    windowMinutes: number;
    maxAttempts: number;
    blockMinutes: number;
  };
  userLimit: {
    enabled: boolean;
    windowMinutes: number;
    maxAttempts: number;
  };
  autoDisable: {
    enabled: boolean;
    violationThreshold: number;
    violationWindowMinutes: number;
  };
}

interface UserWatchingUpdateConfigResponse {
  username: string;
  permission: {
    enabled: boolean;
    allowCustomSchedule: boolean;
    allowTriggerLink: boolean;
  };
  userConfig: {
    cronExpression?: string;
    timezone?: string;
  } | null;
  effective: {
    enabled: boolean;
    cronExpression: string;
    timezone: string;
  };
  sources: {
    cron: ConfigSource;
    timezone: ConfigSource;
  };
  audit?: {
    updatedAt?: number | null;
    operator?: string | null;
  };
  triggerLinkAccessControl: TriggerLinkAccessControlConfig;
}

interface AdminTriggerLinkResponse {
  username: string;
  permission: {
    allowTriggerLink: boolean;
  };
  triggerLink: {
    enabled: boolean;
    disabledReason: string | null;
    disabledAt: number | null;
    disabledSource: 'admin' | 'system' | 'user' | null;
    createdAt: number | null;
    rotatedAt: number | null;
    expiresAt: number | null;
    hasToken: boolean;
    tokenConfigured: boolean;
    expired: boolean;
    tokenId: string | null;
    maskedToken: string | null;
    canRevealToken: boolean;
    triggerLink: string | null;
    fullToken?: string;
    fullTriggerLink?: string | null;
  };
}

interface UserWatchingUpdateConfigPanelProps {
  username: string;
  userRole: UserRole;
  systemUpdateCheckEnabled: boolean;
  onRefresh: () => Promise<void>;
  mode?: PanelMode;
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
  user: '用户配置',
  system: '系统配置',
  default: '默认值',
};

const DEFAULT_TRIGGER_LINK_ACCESS_CONTROL: TriggerLinkAccessControlConfig = {
  enabled: true,
  ipLimit: {
    enabled: true,
    windowMinutes: 60,
    maxAttempts: 5,
    blockMinutes: 30,
  },
  userLimit: {
    enabled: true,
    windowMinutes: 24 * 60,
    maxAttempts: 20,
  },
  autoDisable: {
    enabled: true,
    violationThreshold: 3,
    violationWindowMinutes: 60,
  },
};

const DISABLED_REASON_LABELS: Record<string, string> = {
  rate_limit_exceeded: '访问频率异常',
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '追更配置请求失败');
  }
  return data as UserWatchingUpdateConfigResponse;
}

async function readTriggerLinkResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '触发链接 Token 请求失败');
  }
  return data as AdminTriggerLinkResponse;
}

function formatTimestamp(value: number | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function UserWatchingUpdateConfigPanel({
  username,
  userRole,
  systemUpdateCheckEnabled,
  onRefresh,
  mode = 'standalone',
}: UserWatchingUpdateConfigPanelProps) {
  const [config, setConfig] = useState<UserWatchingUpdateConfigResponse | null>(
    null,
  );
  const [permissionEnabled, setPermissionEnabled] = useState(false);
  const [allowCustomSchedule, setAllowCustomSchedule] = useState(true);
  const [allowTriggerLink, setAllowTriggerLink] = useState(false);
  const [cronMode, setCronMode] = useState<ConfigMode>('inherit');
  const [cronExpression, setCronExpression] = useState('*/30 * * * *');
  const [timezoneMode, setTimezoneMode] = useState<ConfigMode>('inherit');
  const [timezone, setTimezone] = useState('UTC');
  const [accessControl, setAccessControl] =
    useState<TriggerLinkAccessControlConfig>(
      DEFAULT_TRIGGER_LINK_ACCESS_CONTROL,
    );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [triggerLink, setTriggerLink] = useState<
    AdminTriggerLinkResponse['triggerLink'] | null
  >(null);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerSaving, setTriggerSaving] = useState<
    'enabled' | 'reveal' | 'manual' | 'generate' | null
  >(null);
  const [manualToken, setManualToken] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const applyConfig = useCallback(
    (next: UserWatchingUpdateConfigResponse, resetDrafts: boolean) => {
      setConfig(next);
      setPermissionEnabled(next.permission.enabled);
      setAllowCustomSchedule(next.permission.allowCustomSchedule);
      setAllowTriggerLink(next.permission.allowTriggerLink);
      if (!resetDrafts) return;

      setCronMode(
        next.userConfig?.cronExpression === undefined ? 'inherit' : 'custom',
      );
      setCronExpression(
        next.userConfig?.cronExpression ?? next.effective.cronExpression,
      );
      setTimezoneMode(
        next.userConfig?.timezone === undefined ? 'inherit' : 'custom',
      );
      setTimezone(next.userConfig?.timezone ?? next.effective.timezone);
      setAccessControl(
        next.triggerLinkAccessControl ?? DEFAULT_TRIGGER_LINK_ACCESS_CONTROL,
      );
    },
    [],
  );

  const loadTriggerLink = useCallback(async () => {
    setTriggerLoading(true);
    try {
      const response = await fetch(triggerLinkUrl(username), {
        cache: 'no-store',
      });
      const data = await readTriggerLinkResponse(response);
      setTriggerLink(data.triggerLink);
      setRevealedToken(null);
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error ? error.message : '触发链接 Token 加载失败',
      });
    } finally {
      setTriggerLoading(false);
    }
  }, [username]);

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
          void loadTriggerLink();
        }
      } catch (error) {
        if (requestId === requestSequence.current) {
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : '追更配置加载失败',
          });
        }
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    },
    [applyConfig, loadTriggerLink, username],
  );

  useEffect(() => {
    setLoading(true);
    setMessage(null);
    void loadConfig(true);
  }, [loadConfig]);

  const targetIsOwner = userRole === 'owner';
  const isAdminManagementMode = mode === 'admin-management';

  const refreshAfterSave = async () => {
    if (!isAdminManagementMode) {
      await onRefresh();
    }
    await loadConfig(true);
  };

  const saveAll = async () => {
    if (cronMode === 'custom' && !validateCronExpression(cronExpression)) {
      setMessage({ type: 'error', text: 'Cron 表达式无效' });
      return;
    }
    if (timezoneMode === 'custom' && !validateTimezone(timezone)) {
      setMessage({ type: 'error', text: '时区无效' });
      return;
    }

    const fieldsToClear: ConfigField[] = [];
    if (
      cronMode === 'inherit' &&
      config?.userConfig?.cronExpression !== undefined
    ) {
      fieldsToClear.push('cronExpression');
    }
    if (
      timezoneMode === 'inherit' &&
      config?.userConfig?.timezone !== undefined
    ) {
      fieldsToClear.push('timezone');
    }

    setSaving(true);
    setMessage(null);
    try {
      if (!targetIsOwner) {
        const permissionResponse = await fetch(
          '/api/admin/settings/update-check/permissions',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: username,
              enabled: permissionEnabled,
            }),
          },
        );
        const data = await permissionResponse.json().catch(() => ({}));
        if (!permissionResponse.ok) {
          throw new Error(data.error || '追更权限更新失败');
        }
      }

      const configResponse = await fetch(configUrl(username), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowCustomSchedule,
          allowTriggerLink,
          triggerLinkAccessControl: accessControl,
          ...(cronMode === 'custom' ? { cronExpression } : {}),
          ...(timezoneMode === 'custom' ? { timezone } : {}),
        }),
      });
      await readResponse(configResponse);

      for (const field of fieldsToClear) {
        const response = await fetch(configUrl(username), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field }),
        });
        await readResponse(response);
      }

      await refreshAfterSave();
      setMessage({ type: 'success', text: '追更系统设置已保存' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '追更系统设置保存失败',
      });
    } finally {
      setSaving(false);
    }
  };

  const clearAllOverrides = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const field of ['cronExpression', 'timezone'] as const) {
        const response = await fetch(configUrl(username), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field }),
        });
        await readResponse(response);
      }
      await refreshAfterSave();
      setMessage({ type: 'success', text: '已恢复系统配置' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '恢复系统配置失败',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateTriggerLink = async (
    action: 'enabled' | 'manual' | 'generate',
    body: Record<string, unknown>,
  ) => {
    setTriggerSaving(action);
    setMessage(null);
    try {
      const response = await fetch(triggerLinkUrl(username), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readTriggerLinkResponse(response);
      setTriggerLink(data.triggerLink);
      setRevealedToken(null);
      if (action === 'manual') setManualToken('');
      setMessage({ type: 'success', text: '触发链接 Token 已更新' });
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error ? error.message : '触发链接 Token 更新失败',
      });
    } finally {
      setTriggerSaving(null);
    }
  };

  const revealTriggerToken = async () => {
    setTriggerSaving('reveal');
    setMessage(null);
    try {
      const response = await fetch(triggerLinkUrl(username), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reveal' }),
      });
      const data = await readTriggerLinkResponse(response);
      setTriggerLink(data.triggerLink);
      setRevealedToken(data.triggerLink.fullToken ?? null);
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error ? error.message : '触发链接 Token 查看失败',
      });
    } finally {
      setTriggerSaving(null);
    }
  };

  const saveManualToken = async () => {
    const token = manualToken.trim();
    if (!token) {
      setMessage({ type: 'error', text: '请输入新的 Token' });
      return;
    }
    await updateTriggerLink('manual', {
      token,
      enabled: triggerLink?.enabled ?? true,
    });
  };

  const updateAccessControl = (
    patch: Partial<TriggerLinkAccessControlConfig>,
  ) => {
    setAccessControl((current) => ({ ...current, ...patch }));
  };

  const updateAccessControlGroup = <
    T extends keyof Omit<TriggerLinkAccessControlConfig, 'enabled'>,
  >(
    group: T,
    patch: Partial<TriggerLinkAccessControlConfig[T]>,
  ) => {
    setAccessControl((current) => ({
      ...current,
      [group]: { ...current[group], ...patch },
    }));
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

  const displayedPermission = targetIsOwner
    ? systemUpdateCheckEnabled
    : permissionEnabled;

  return (
    <div className='space-y-5'>
      {message && <StatusMessage type={message.type} text={message.text} />}

      <section className='space-y-4 border-b border-gray-200 pb-5 dark:border-gray-700'>
        <SectionHeading icon='shield' title='追更权限' />
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div className='text-sm text-gray-600 dark:text-gray-400'>
            <p>授权状态：{displayedPermission ? '已启用' : '已禁用'}</p>
            <p>生效状态：{config.effective.enabled ? '已启用' : '已禁用'}</p>
            <p>操作人：{config.audit?.operator ?? '-'}</p>
          </div>
          <div className='flex items-center gap-3'>
            <Switch
              label='追更授权'
              checked={displayedPermission}
              disabled={targetIsOwner || saving}
              onChange={() => setPermissionEnabled((current) => !current)}
            />
          </div>
        </div>
      </section>

      <section className='space-y-4 border-b border-gray-200 pb-5 dark:border-gray-700'>
        <SectionHeading icon='sliders' title='能力限制' />
        <div className='grid gap-3 sm:grid-cols-2'>
          <SwitchRow
            label='允许用户自定义调度'
            description='控制用户是否可在用户中心修改 Cron 和时区。'
            checked={allowCustomSchedule}
            disabled={saving}
            onChange={() => setAllowCustomSchedule((current) => !current)}
          />
          <SwitchRow
            label='允许触发链接'
            description='控制用户是否可管理外部触发链接。'
            checked={allowTriggerLink}
            disabled={saving}
            onChange={() => setAllowTriggerLink((current) => !current)}
          />
        </div>
      </section>

      <section className='space-y-4 border-b border-gray-200 pb-5 dark:border-gray-700'>
        <SectionHeading icon='key' title='触发链接 Token' />
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          <TokenStatusItem
            label='启用状态'
            value={
              triggerLoading
                ? '加载中'
                : triggerLink?.enabled
                  ? '已启用'
                  : '已关闭'
            }
          />
          <TokenStatusItem
            label='当前 Token 状态'
            value={
              triggerLink?.hasToken
                ? triggerLink.expired
                  ? '已过期'
                  : '已配置'
                : '未配置'
            }
          />
          <TokenStatusItem
            label='脱敏 Token'
            value={triggerLink?.maskedToken ?? '-'}
            mono
          />
          <TokenStatusItem
            label='最后修改'
            value={formatTimestamp(triggerLink?.rotatedAt)}
          />
          <TokenStatusItem
            label='关闭原因'
            value={
              triggerLink?.disabledReason
                ? (DISABLED_REASON_LABELS[triggerLink.disabledReason] ??
                  triggerLink.disabledReason)
                : '-'
            }
          />
          <TokenStatusItem
            label='关闭时间'
            value={formatTimestamp(triggerLink?.disabledAt)}
          />
        </div>

        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            disabled={
              triggerLoading ||
              triggerSaving !== null ||
              triggerLink?.hasToken !== true
            }
            onClick={() =>
              void updateTriggerLink('enabled', {
                enabled: !(triggerLink?.enabled ?? false),
              })
            }
            className='inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
          >
            {triggerLink?.enabled ? '关闭触发链接' : '启用触发链接'}
          </button>
          <button
            type='button'
            disabled={
              triggerLoading ||
              triggerSaving !== null ||
              triggerLink?.hasToken !== true
            }
            onClick={() => void revealTriggerToken()}
            className='inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
          >
            {revealedToken ? (
              <EyeOff className='h-4 w-4' />
            ) : (
              <Eye className='h-4 w-4' />
            )}
            查看 Token
          </button>
          <button
            type='button'
            disabled={triggerLoading || triggerSaving !== null}
            onClick={() =>
              void updateTriggerLink('generate', { action: 'generate' })
            }
            className='inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
          >
            <RefreshCw className='h-4 w-4' />
            重新生成
          </button>
        </div>

        {revealedToken && (
          <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30'>
            <div className='text-xs font-medium text-amber-800 dark:text-amber-200'>
              完整 Token
            </div>
            <div className='mt-2 break-all rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-amber-900 dark:bg-gray-950 dark:text-gray-100'>
              {revealedToken}
            </div>
          </div>
        )}

        <div className='grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end'>
          <label className='block'>
            <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
              手动输入新 Token
            </span>
            <input
              value={manualToken}
              disabled={triggerLoading || triggerSaving !== null}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder='输入后保存，旧 Token 将立即失效'
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
          </label>
          <button
            type='button'
            disabled={
              triggerLoading ||
              triggerSaving !== null ||
              manualToken.trim().length === 0
            }
            onClick={() => void saveManualToken()}
            className='inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
          >
            <Save className='h-4 w-4' />
            修改 Token
          </button>
        </div>
      </section>

      <section className='space-y-4 border-b border-gray-200 pb-5 dark:border-gray-700'>
        <SectionHeading icon='shield' title='触发链接限制' />
        <SwitchRow
          label='总限制开关'
          description='关闭后不执行 IP、用户访问次数和自动关闭检查。'
          checked={accessControl.enabled}
          disabled={saving}
          onChange={() =>
            updateAccessControl({ enabled: !accessControl.enabled })
          }
        />

        <div className='grid gap-3 lg:grid-cols-3'>
          <div className='space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
            <Switch
              label='IP访问限制'
              checked={accessControl.ipLimit.enabled}
              disabled={saving || !accessControl.enabled}
              onChange={() =>
                updateAccessControlGroup('ipLimit', {
                  enabled: !accessControl.ipLimit.enabled,
                })
              }
            />
            <div>
              <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                IP访问限制
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                超过次数后拒绝请求并临时封禁 IP。
              </p>
            </div>
            <NumberField
              label='时间窗口（分钟）'
              value={accessControl.ipLimit.windowMinutes}
              disabled={saving || !accessControl.enabled}
              onChange={(value) =>
                updateAccessControlGroup('ipLimit', {
                  windowMinutes: value,
                })
              }
            />
            <NumberField
              label='最大访问次数'
              value={accessControl.ipLimit.maxAttempts}
              disabled={saving || !accessControl.enabled}
              onChange={(value) =>
                updateAccessControlGroup('ipLimit', { maxAttempts: value })
              }
            />
            <NumberField
              label='IP封禁时间（分钟）'
              value={accessControl.ipLimit.blockMinutes}
              disabled={saving || !accessControl.enabled}
              onChange={(value) =>
                updateAccessControlGroup('ipLimit', { blockMinutes: value })
              }
            />
          </div>

          <div className='space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
            <Switch
              label='用户访问限制'
              checked={accessControl.userLimit.enabled}
              disabled={saving || !accessControl.enabled}
              onChange={() =>
                updateAccessControlGroup('userLimit', {
                  enabled: !accessControl.userLimit.enabled,
                })
              }
            />
            <div>
              <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                用户访问限制
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                基于 Token 对应用户统计访问次数。
              </p>
            </div>
            <NumberField
              label='时间窗口（分钟）'
              value={accessControl.userLimit.windowMinutes}
              disabled={saving || !accessControl.enabled}
              onChange={(value) =>
                updateAccessControlGroup('userLimit', {
                  windowMinutes: value,
                })
              }
            />
            <NumberField
              label='最大访问次数'
              value={accessControl.userLimit.maxAttempts}
              disabled={saving || !accessControl.enabled}
              onChange={(value) =>
                updateAccessControlGroup('userLimit', { maxAttempts: value })
              }
            />
          </div>

          <div className='space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
            <Switch
              label='自动关闭策略'
              checked={accessControl.autoDisable.enabled}
              disabled={saving || !accessControl.enabled}
              onChange={() =>
                updateAccessControlGroup('autoDisable', {
                  enabled: !accessControl.autoDisable.enabled,
                })
              }
            />
            <div>
              <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                自动关闭策略
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                违规达到阈值后关闭该用户触发链接。
              </p>
            </div>
            <NumberField
              label='违规次数阈值'
              value={accessControl.autoDisable.violationThreshold}
              disabled={saving || !accessControl.enabled}
              onChange={(value) =>
                updateAccessControlGroup('autoDisable', {
                  violationThreshold: value,
                })
              }
            />
            <NumberField
              label='违规统计周期（分钟）'
              value={accessControl.autoDisable.violationWindowMinutes}
              disabled={saving || !accessControl.enabled}
              onChange={(value) =>
                updateAccessControlGroup('autoDisable', {
                  violationWindowMinutes: value,
                })
              }
            />
          </div>
        </div>
      </section>

      <section className='space-y-0'>
        <SectionHeading icon='sliders' title='用户配置管理' />
        <StrategySection
          title='Cron'
          effective={config.effective.cronExpression}
          override={config.userConfig?.cronExpression}
          source={config.sources.cron}
          mode={cronMode}
          onModeChange={setCronMode}
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
                    CRON_PRESETS.some(
                      (preset) => preset.value === cronExpression,
                    )
                      ? cronExpression
                      : ''
                  }
                  onChange={(event) => {
                    if (event.target.value)
                      setCronExpression(event.target.value);
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
                  Cron 表达式
                </span>
                <input
                  aria-label='Cron 表达式'
                  value={cronExpression}
                  onChange={(event) => setCronExpression(event.target.value)}
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
              </label>
            </div>
          )}
        </StrategySection>

        <StrategySection
          title='时区'
          effective={config.effective.timezone}
          override={config.userConfig?.timezone}
          source={config.sources.timezone}
          mode={timezoneMode}
          onModeChange={setTimezoneMode}
        >
          {timezoneMode === 'custom' && (
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='block'>
                <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                  时区预设
                </span>
                <select
                  aria-label='时区预设'
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
                  IANA 时区
                </span>
                <input
                  aria-label='IANA 时区'
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
              </label>
            </div>
          )}
        </StrategySection>
      </section>

      <div className='flex flex-col gap-2 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row sm:justify-end'>
        <button
          type='button'
          disabled={saving}
          onClick={clearAllOverrides}
          className='inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
        >
          清除 Cron/时区覆盖
        </button>
        <ActionButton label='保存全部设置' loading={saving} onClick={saveAll} />
      </div>
    </div>
  );
}

function configUrl(username: string) {
  return `/api/admin/watching-updates/users/${encodeURIComponent(username)}/config`;
}

function triggerLinkUrl(username: string) {
  return `/api/admin/watching-updates/users/${encodeURIComponent(username)}/trigger-link`;
}

function StatusMessage({
  type,
  text,
}: {
  type: 'success' | 'error';
  text: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        type === 'success'
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
      }`}
    >
      {type === 'success' ? (
        <CheckCircle className='h-4 w-4 shrink-0' />
      ) : (
        <XCircle className='h-4 w-4 shrink-0' />
      )}
      {text}
    </div>
  );
}

function SectionHeading({
  icon,
  title,
}: {
  icon: 'shield' | 'sliders' | 'key';
  title: string;
}) {
  const Icon =
    icon === 'shield'
      ? ShieldCheck
      : icon === 'key'
        ? KeyRound
        : SlidersHorizontal;
  return (
    <div className='flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
      <Icon className='h-4 w-4 text-blue-600 dark:text-blue-400' />
      {title}
    </div>
  );
}

function TokenStatusItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className='rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
      <div className='text-xs text-gray-500 dark:text-gray-400'>{label}</div>
      <div
        className={`mt-1 break-all text-sm font-medium text-gray-900 dark:text-gray-100 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className='block'>
      <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
        {label}
      </span>
      <input
        type='number'
        min={1}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(Math.max(1, Number.parseInt(event.target.value, 10) || 1))
        }
        className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
      />
    </label>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className='flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
      <div>
        <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
          {label}
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          {description}
        </p>
      </div>
      <Switch
        label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
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
  children,
}: {
  title: string;
  effective: string;
  override?: string;
  source: ConfigSource;
  mode: ConfigMode;
  onModeChange: (mode: ConfigMode) => void;
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
              当前生效：{' '}
              <span className='font-mono text-gray-900 dark:text-gray-100'>
                {effective}
              </span>
            </p>
            <p>
              用户配置：{' '}
              <span className='font-mono text-gray-900 dark:text-gray-100'>
                {override ?? '未设置'}
              </span>
            </p>
            <p>
              来源：{' '}
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
    </section>
  );
}

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
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
