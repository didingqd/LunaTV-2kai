'use client';

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  KeyRound,
  LoaderCircle,
  PlayCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { WatchCompletionThresholdSetting } from './WatchCompletionThresholdSetting';
import { WatchingUpdateModeSetting } from './WatchingUpdateModeSetting';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { validateCronExpression } from '@/lib/scheduler/cron-utils';
import {
  SCHEDULER_TIMEZONE_PRESETS,
  validateTimezone,
} from '@/lib/scheduler/timezone-utils';

type ConfigSource = 'user' | 'system' | 'default';
type ConfigField = 'cronExpression' | 'timezone';
type TriggerAction = 'reveal' | 'test';

interface WatchingUpdateUserConfigResponse {
  permission: {
    enabled: boolean;
    allowCustomSchedule: boolean;
    allowTriggerLink: boolean;
  };
  userConfig: {
    cronExpression?: string;
    timezone?: string;
    triggerLink?: unknown;
  } | null;
  effectiveConfig: {
    enabled: boolean;
    cronExpression: string;
    timezone: string;
  };
  sources: {
    cron: ConfigSource;
    timezone: ConfigSource;
  };
}

interface TriggerLinkStatusResponse {
  enabled: boolean;
  createdAt: number | null;
  rotatedAt: number | null;
  expiresAt: number | null;
  hasToken: boolean;
  tokenConfigured?: boolean;
  expired: boolean;
  tokenId?: string | null;
  maskedToken?: string | null;
  canRevealToken?: boolean;
  triggerLink?: string | null;
  fullToken?: string;
  fullTriggerLink?: string | null;
}

interface TriggerTestResult {
  ok: boolean;
  statusCode: number;
  success: boolean;
  accepted?: boolean;
  status?: string;
  running?: boolean;
  taskId?: string | null;
  error?: string;
}

const USER_CONFIG_ENDPOINT = '/api/user/watching-updates/config';
const TRIGGER_LINK_ENDPOINT = '/api/user/watching-updates/trigger-link';

const CRON_PRESETS = [
  { label: '每30分钟', value: '*/30 * * * *' },
  { label: '每1小时', value: '0 * * * *' },
  { label: '每6小时', value: '0 */6 * * *' },
  { label: '每12小时', value: '0 */12 * * *' },
  { label: '每24小时', value: '0 0 * * *' },
] as const;

const SOURCE_LABELS: Record<ConfigSource, string> = {
  user: '用户配置',
  system: '系统配置',
  default: '默认值',
};

async function readConfigResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('请先登录后查看追更系统设置');
    if (response.status === 403) throw new Error('管理员未允许修改自定义调度');
    if (response.status === 400) {
      throw new Error(data.error || '配置格式无效，请检查后重试');
    }
    throw new Error(data.error || '追更系统设置请求失败');
  }
  return data as WatchingUpdateUserConfigResponse;
}

async function readTriggerLinkResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('请先登录后管理触发链接');
    if (response.status === 403) throw new Error('管理员未允许使用触发链接');
    if (response.status === 400) {
      throw new Error(data.error || '触发链接请求格式无效');
    }
    throw new Error(data.error || '触发链接请求失败');
  }
  return data as TriggerLinkStatusResponse;
}

function statusText(enabled: boolean) {
  return enabled ? '已启用' : '未启用';
}

function allowedText(allowed: boolean) {
  return allowed ? '允许' : '不允许';
}

function getUserValueLabel(value: string | undefined) {
  return value === undefined ? '继承系统配置' : value;
}

function formatTimestamp(value: number | null) {
  if (value === null) return '无';
  return new Date(value).toLocaleString();
}

function getTriggerStatusLabel(status: TriggerLinkStatusResponse | null) {
  if (!status || !status.hasToken) return '未创建';
  if (status.expired) return '已过期';
  return status.enabled ? '已启用' : '已禁用';
}

function getSettingsUsername() {
  return getAuthInfoFromBrowserCookie()?.username?.trim() || null;
}

export default function WatchingUpdateSettingsPage({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const settingsUsername = getSettingsUsername();
  const [config, setConfig] = useState<WatchingUpdateUserConfigResponse | null>(
    null,
  );
  const [cronExpression, setCronExpression] = useState('*/30 * * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ConfigField | 'all' | null>(null);
  const [triggerLink, setTriggerLink] =
    useState<TriggerLinkStatusResponse | null>(null);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerSaving, setTriggerSaving] = useState<TriggerAction | null>(
    null,
  );
  const [fullTriggerLink, setFullTriggerLink] = useState<string | null>(null);
  const [triggerTestResult, setTriggerTestResult] =
    useState<TriggerTestResult | null>(null);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const requestSequence = useRef(0);

  const loadTriggerLink = useCallback(async () => {
    setTriggerLoading(true);
    try {
      const response = await fetch(TRIGGER_LINK_ENDPOINT, {
        cache: 'no-store',
      });
      const data = await readTriggerLinkResponse(response);
      setTriggerLink(data);
      setFullTriggerLink(null);
      setTriggerTestResult(null);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '触发链接请求失败',
      });
    } finally {
      setTriggerLoading(false);
    }
  }, []);

  const applyConfig = useCallback(
    (nextConfig: WatchingUpdateUserConfigResponse) => {
      setConfig(nextConfig);
      setCronExpression(
        nextConfig.userConfig?.cronExpression ??
          nextConfig.effectiveConfig.cronExpression,
      );
      setTimezone(
        nextConfig.userConfig?.timezone ?? nextConfig.effectiveConfig.timezone,
      );
    },
    [],
  );

  const loadConfig = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      const response = await fetch(USER_CONFIG_ENDPOINT, { cache: 'no-store' });
      const data = await readConfigResponse(response);
      if (requestId === requestSequence.current) {
        applyConfig(data);
        if (data.permission.allowTriggerLink) {
          await loadTriggerLink();
        } else {
          setTriggerLink(null);
          setFullTriggerLink(null);
          setTriggerTestResult(null);
        }
      }
    } catch (error) {
      if (requestId === requestSequence.current) {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '追更系统设置请求失败',
        });
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [applyConfig, loadTriggerLink]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const sendConfigRequest = async (
    method: 'PATCH' | 'DELETE',
    body: Record<string, unknown>,
  ) => {
    const response = await fetch(USER_CONFIG_ENDPOINT, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await readConfigResponse(response);
    await loadConfig();
  };

  const saveCronExpression = async () => {
    if (!validateCronExpression(cronExpression)) {
      setMessage({ type: 'error', text: 'Cron 表达式格式无效' });
      return;
    }

    setSaving('cronExpression');
    setMessage(null);
    try {
      await sendConfigRequest('PATCH', { cronExpression });
      setMessage({ type: 'success', text: 'Cron 配置已保存' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Cron 配置保存失败',
      });
    } finally {
      setSaving(null);
    }
  };

  const saveTimezone = async () => {
    if (!validateTimezone(timezone)) {
      setMessage({ type: 'error', text: '时区格式无效' });
      return;
    }

    setSaving('timezone');
    setMessage(null);
    try {
      await sendConfigRequest('PATCH', { timezone });
      setMessage({ type: 'success', text: '时区配置已保存' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '时区配置保存失败',
      });
    } finally {
      setSaving(null);
    }
  };

  const clearOverride = async (field?: ConfigField) => {
    setSaving(field ?? 'all');
    setMessage(null);
    try {
      await sendConfigRequest('DELETE', field ? { field } : {});
      setMessage({ type: 'success', text: '已恢复系统配置' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '恢复系统配置失败',
      });
    } finally {
      setSaving(null);
    }
  };

  const revealTriggerLink = async () => {
    setTriggerSaving('reveal');
    setMessage(null);
    try {
      const response = await fetch(TRIGGER_LINK_ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reveal' }),
      });
      const data = await readTriggerLinkResponse(response);
      setTriggerLink(data);
      const link = data.fullTriggerLink ?? null;
      setFullTriggerLink(link);
      setTriggerTestResult(null);
      setMessage({ type: 'success', text: '触发链接已显示' });
      return link;
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '触发链接查看失败',
      });
      return null;
    } finally {
      setTriggerSaving(null);
    }
  };

  const copyTriggerLink = async () => {
    if (!fullTriggerLink) return;
    try {
      await navigator.clipboard.writeText(fullTriggerLink);
      setMessage({ type: 'success', text: '触发链接已复制' });
    } catch {
      setMessage({ type: 'error', text: '复制失败，请手动复制触发链接' });
    }
  };

  const testTriggerLink = async () => {
    setTriggerSaving('test');
    setMessage(null);
    setTriggerTestResult(null);
    try {
      const link = fullTriggerLink ?? (await revealTriggerLink());
      if (!link) return;

      const response = await fetch(link, { cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as Partial<
        TriggerTestResult
      >;
      setTriggerTestResult({
        ok: response.ok,
        statusCode: response.status,
        success: data.success === true,
        accepted: data.accepted,
        status: data.status,
        running: data.running,
        taskId: data.taskId,
        error: data.error,
      });
    } catch (error) {
      setTriggerTestResult({
        ok: false,
        statusCode: 0,
        success: false,
        error: error instanceof Error ? error.message : '服务异常',
      });
    } finally {
      setTriggerSaving(null);
    }
  };

  const canEditSchedule = config?.permission.allowCustomSchedule === true;
  const controlsDisabled = loading || !canEditSchedule || saving !== null;
  const canUseTriggerLink = config?.permission.allowTriggerLink === true;
  const triggerControlsDisabled =
    loading || triggerLoading || triggerSaving !== null || !canUseTriggerLink;

  return (
    <div
      className={
        embedded
          ? 'text-slate-900 dark:text-slate-100'
          : 'min-h-screen bg-slate-50 px-4 py-6 text-slate-900 dark:bg-gray-950 dark:text-slate-100 sm:px-6 lg:px-8'
      }
    >
      <div
        className={
          embedded
            ? 'flex w-full flex-col gap-4'
            : 'mx-auto flex w-full max-w-5xl flex-col gap-5'
        }
      >
        <header
          className={
            embedded
              ? 'flex flex-col gap-2 border-b border-slate-200 pb-3 dark:border-gray-800'
              : 'flex flex-col gap-2 border-b border-slate-200 pb-4 dark:border-gray-800'
          }
        >
          <div className='flex items-center gap-3'>
            <SlidersHorizontal className='h-7 w-7 text-sky-600 dark:text-sky-400' />
            <h1
              className={
                embedded
                  ? 'text-lg font-semibold tracking-normal'
                  : 'text-2xl font-semibold tracking-normal'
              }
            >
              更新设置
            </h1>
          </div>
          <p className='max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400'>
            管理更新检测、更新提醒、观看完成策略、更新获取策略和手动更新。
          </p>
        </header>

        {message && (
          <div
            role='status'
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
              message.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0' />
            ) : (
              <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {loading && !config ? (
          <div className='flex min-h-[280px] items-center justify-center rounded-md border border-slate-200 bg-white text-sm text-slate-500 dark:border-gray-800 dark:bg-gray-900 dark:text-slate-400'>
            <LoaderCircle className='mr-2 h-4 w-4 animate-spin' />
            正在加载追更系统设置
          </div>
        ) : config ? (
          <>
            <section className='rounded-md border border-slate-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900'>
              <div className='mb-4 flex items-center gap-2'>
                <SlidersHorizontal className='h-5 w-5 text-sky-600 dark:text-sky-400' />
                <h2 className='text-lg font-semibold tracking-normal'>
                  更新策略
                </h2>
              </div>
              <div className='space-y-5'>
                <WatchingUpdateModeSetting />
                {settingsUsername && (
                  <>
                    <div className='border-t border-slate-200 dark:border-gray-800'></div>
                    <WatchCompletionThresholdSetting
                      username={settingsUsername}
                    />
                  </>
                )}
              </div>
            </section>

            <section className='rounded-md border border-slate-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900'>
              <div className='mb-4 flex items-center gap-2'>
                <ShieldCheck className='h-5 w-5 text-emerald-600 dark:text-emerald-400' />
                <h2 className='text-lg font-semibold tracking-normal'>
                  追更状态
                </h2>
              </div>
              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                <StatusItem
                  label='追更权限'
                  value={allowedText(config.permission.enabled)}
                />
                <StatusItem
                  label='启用状态'
                  value={statusText(config.effectiveConfig.enabled)}
                />
                <StatusItem
                  label='自定义调度'
                  value={allowedText(config.permission.allowCustomSchedule)}
                />
                <StatusItem
                  label='触发链接'
                  value={
                    config.permission.allowTriggerLink ? '允许' : '暂不可用'
                  }
                />
              </div>
            </section>

            <section className='rounded-md border border-slate-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900'>
              <div className='mb-4 flex items-center gap-2'>
                <KeyRound className='h-5 w-5 text-violet-600 dark:text-violet-400' />
                <h2 className='text-lg font-semibold tracking-normal'>
                  更新检测触发链接
                </h2>
              </div>

              {!canUseTriggerLink ? (
                <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'>
                  管理员未允许使用触发链接。
                </div>
              ) : (
                <div className='space-y-4'>
                  <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                    <StatusItem
                      label='链接状态'
                      value={
                        triggerLoading
                          ? '加载中'
                          : getTriggerStatusLabel(triggerLink)
                      }
                    />
                    <StatusItem
                      label='启用状态'
                      value={triggerLink?.enabled ? '已启用' : '已关闭'}
                    />
                    <StatusItem
                      label='Token 配置'
                      value={
                        triggerLink?.hasToken
                          ? (triggerLink.maskedToken ?? '已配置')
                          : '未配置'
                      }
                    />
                    <StatusItem
                      label='过期时间'
                      value={formatTimestamp(triggerLink?.expiresAt ?? null)}
                    />
                  </div>

                  {triggerLink?.hasToken ? (
                    <div className='rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950'>
                      <label
                        htmlFor='watching-update-trigger-link'
                        className='mb-2 block text-sm font-medium text-sky-900 dark:text-sky-100'
                      >
                        更新检测触发链接
                      </label>
                      <div className='flex flex-col gap-2'>
                        <textarea
                          id='watching-update-trigger-link'
                          readOnly
                          value={
                            fullTriggerLink ??
                            triggerLink.triggerLink ??
                            'Token 未配置'
                          }
                          rows={3}
                          className='min-w-0 resize-none rounded-md border border-sky-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-sky-800 dark:bg-gray-950 dark:text-slate-100'
                        />
                        <div className='flex flex-wrap gap-2'>
                          <button
                            type='button'
                            disabled={triggerControlsDisabled}
                            onClick={() => void revealTriggerLink()}
                            className='inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-sky-300 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-800 dark:text-sky-100 dark:hover:bg-sky-900'
                          >
                            <Eye className='h-4 w-4' />
                            查看触发链接
                          </button>
                          <button
                            type='button'
                            disabled={
                              triggerControlsDisabled || !fullTriggerLink
                            }
                            onClick={() => void copyTriggerLink()}
                            className='inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-sky-300 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-800 dark:text-sky-100 dark:hover:bg-sky-900'
                          >
                            <Copy className='h-4 w-4' />
                            复制链接
                          </button>
                          <button
                            type='button'
                            disabled={
                              triggerControlsDisabled || !triggerLink.enabled
                            }
                            onClick={() => void testTriggerLink()}
                            className='inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-gray-700 dark:disabled:text-slate-400'
                          >
                            {triggerSaving === 'test' ? (
                              <LoaderCircle className='h-4 w-4 animate-spin' />
                            ) : (
                              <PlayCircle className='h-4 w-4' />
                            )}
                            测试连接
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'>
                      管理员尚未配置触发链接 Token。
                    </div>
                  )}

                  {triggerTestResult && (
                    <div
                      role='status'
                      className={`rounded-md border px-3 py-2 text-sm ${
                        triggerTestResult.ok && triggerTestResult.success
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                          : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
                      }`}
                    >
                      <div className='font-semibold'>
                        {triggerTestResult.ok && triggerTestResult.success
                          ? '请求成功'
                          : '请求失败'}
                      </div>
                      <div className='mt-2 space-y-1 text-xs'>
                        <div>HTTP 状态：{triggerTestResult.statusCode}</div>
                        <div>
                          当前检测状态：{triggerTestResult.status ?? '-'}
                        </div>
                        <div>
                          是否启动任务：
                          {triggerTestResult.accepted === undefined
                            ? '-'
                            : triggerTestResult.accepted
                              ? '是'
                              : '否'}
                        </div>
                        {triggerTestResult.error && (
                          <div>错误原因：{triggerTestResult.error}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className='rounded-md border border-slate-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900'>
              <div className='mb-4 flex items-center gap-2'>
                <Clock3 className='h-5 w-5 text-sky-600 dark:text-sky-400' />
                <h2 className='text-lg font-semibold tracking-normal'>
                  调度设置
                </h2>
              </div>

              {!canEditSchedule && (
                <div className='mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'>
                  管理员未允许修改自定义调度。
                </div>
              )}

              <div className='grid gap-5 lg:grid-cols-2'>
                <div className='space-y-3'>
                  <div>
                    <label
                      htmlFor='watching-update-cron'
                      className='mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
                    >
                      Cron 表达式
                    </label>
                    <input
                      id='watching-update-cron'
                      value={cronExpression}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setCronExpression(event.target.value)
                      }
                      className='w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-gray-700 dark:bg-gray-950 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:ring-sky-950 dark:disabled:bg-gray-800'
                    />
                  </div>
                  <p className='text-xs text-slate-500 dark:text-slate-400'>
                    当前用户配置：
                    {getUserValueLabel(config.userConfig?.cronExpression)}
                  </p>
                  <div
                    className='flex flex-wrap gap-2'
                    aria-label='Cron 常用预设'
                  >
                    {CRON_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type='button'
                        disabled={controlsDisabled}
                        onClick={() => setCronExpression(preset.value)}
                        className='rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-slate-300 dark:hover:bg-gray-800'
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      type='button'
                      disabled={controlsDisabled}
                      onClick={saveCronExpression}
                      className='inline-flex min-h-9 items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-gray-700 dark:disabled:text-slate-400'
                    >
                      <Save className='h-4 w-4' />
                      保存 Cron
                    </button>
                    <button
                      type='button'
                      disabled={controlsDisabled}
                      onClick={() => clearOverride('cronExpression')}
                      className='inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-slate-300 dark:hover:bg-gray-800'
                    >
                      <RefreshCw className='h-4 w-4' />
                      恢复 Cron 系统配置
                    </button>
                  </div>
                </div>

                <div className='space-y-3'>
                  <div>
                    <label
                      htmlFor='watching-update-timezone'
                      className='mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300'
                    >
                      IANA 时区
                    </label>
                    <input
                      id='watching-update-timezone'
                      value={timezone}
                      disabled={controlsDisabled}
                      onChange={(event) => setTimezone(event.target.value)}
                      className='w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-gray-700 dark:bg-gray-950 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:ring-sky-950 dark:disabled:bg-gray-800'
                    />
                  </div>
                  <p className='text-xs text-slate-500 dark:text-slate-400'>
                    当前用户配置：
                    {getUserValueLabel(config.userConfig?.timezone)}
                  </p>
                  <div
                    className='flex flex-wrap gap-2'
                    aria-label='时区常用选项'
                  >
                    {SCHEDULER_TIMEZONE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type='button'
                        disabled={controlsDisabled}
                        onClick={() => setTimezone(preset)}
                        className='rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-slate-300 dark:hover:bg-gray-800'
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      type='button'
                      disabled={controlsDisabled}
                      onClick={saveTimezone}
                      className='inline-flex min-h-9 items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-gray-700 dark:disabled:text-slate-400'
                    >
                      <Save className='h-4 w-4' />
                      保存时区
                    </button>
                    <button
                      type='button'
                      disabled={controlsDisabled}
                      onClick={() => clearOverride('timezone')}
                      className='inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-slate-300 dark:hover:bg-gray-800'
                    >
                      <RefreshCw className='h-4 w-4' />
                      恢复时区系统配置
                    </button>
                  </div>
                </div>
              </div>

              <div className='mt-5 border-t border-slate-200 pt-4 dark:border-gray-800'>
                <button
                  type='button'
                  disabled={controlsDisabled}
                  onClick={() => clearOverride()}
                  className='inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-slate-300 dark:hover:bg-gray-800'
                >
                  <RefreshCw className='h-4 w-4' />
                  恢复系统配置
                </button>
              </div>
            </section>

            <section className='rounded-md border border-slate-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900'>
              <div className='mb-4 flex items-center gap-2'>
                <CheckCircle2 className='h-5 w-5 text-emerald-600 dark:text-emerald-400' />
                <h2 className='text-lg font-semibold tracking-normal'>
                  当前生效配置
                </h2>
              </div>
              <div className='grid gap-3 sm:grid-cols-2'>
                <EffectiveItem
                  label='最终 Cron'
                  value={config.effectiveConfig.cronExpression}
                  source={SOURCE_LABELS[config.sources.cron]}
                />
                <EffectiveItem
                  label='最终时区'
                  value={config.effectiveConfig.timezone}
                  source={SOURCE_LABELS[config.sources.timezone]}
                />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md border border-slate-200 px-3 py-3 dark:border-gray-800'>
      <div className='text-xs text-slate-500 dark:text-slate-400'>{label}</div>
      <div className='mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100'>
        {value}
      </div>
    </div>
  );
}

function EffectiveItem({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div className='rounded-md border border-slate-200 px-3 py-3 dark:border-gray-800'>
      <div className='text-xs text-slate-500 dark:text-slate-400'>{label}</div>
      <div className='mt-1 break-all font-mono text-sm font-semibold text-slate-900 dark:text-slate-100'>
        {value}
      </div>
      <div className='mt-2 text-xs text-slate-500 dark:text-slate-400'>
        来源：{source}
      </div>
    </div>
  );
}
