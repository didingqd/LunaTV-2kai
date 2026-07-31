'use client';

import {
  Check,
  CheckCircle2,
  Edit3,
  LoaderCircle,
  MessageSquarePlus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import {
  DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS,
  NOTIFICATION_EVENT_METAS,
  NOTIFICATION_PROVIDER_METAS,
  getCreatableNotificationProviderMetas,
  getNotificationProviderMeta,
  type NotificationProviderMeta,
} from './notification-settings-provider-ui';

interface NotificationChannelConfig {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  subscribedEvents?: string[];
  config: Record<string, unknown>;
}

interface NotificationSettings {
  version?: number;
  inboxEnabled: boolean;
  watchingUpdateFoundEnabled: boolean;
  watchingUpdateFailedEnabled: boolean;
  channels: NotificationChannelConfig[];
  updatedAt?: number;
}

interface SettingsResponse {
  settings: NotificationSettings;
}

interface ChannelFormState {
  mode: 'create' | 'edit';
  channelId?: string;
  providerType: string;
  name: string;
  subscribedEvents: string[];
  config: Record<string, string>;
  originalConfig: Record<string, string>;
}

interface ChannelTestResult {
  status: 'success' | 'error';
  message: string;
  time: number;
}

const NOTIFICATION_SETTINGS_ENDPOINT = '/api/user/notification-settings';
const NOTIFICATION_CHANNELS_ENDPOINT = `${NOTIFICATION_SETTINGS_ENDPOINT}/channels`;
const NOTIFICATION_TEST_ENDPOINT = `${NOTIFICATION_SETTINGS_ENDPOINT}/test`;

async function readSettingsResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('请先登录后修改通知设置');
    if (response.status === 403) throw new Error('只有管理员可以修改通知设置');
    if (response.status === 400)
      throw new Error(data.error || '通知设置格式无效');
    throw new Error(data.error || '通知设置请求失败');
  }
  return data as SettingsResponse;
}

function isAdminRole(role?: string) {
  return role === 'owner' || role === 'admin';
}

function getCompatibleSubscribedEvents(
  channel: NotificationChannelConfig,
  settings: NotificationSettings,
) {
  if (Array.isArray(channel.subscribedEvents)) return channel.subscribedEvents;

  // 仅用于旧数据兼容展示：UI 保存时只写每个渠道自己的 subscribedEvents，
  // 不再渲染或提交 watchingUpdateFoundEnabled / watchingUpdateFailedEnabled 大表单。
  const events: string[] = [];
  if (settings.watchingUpdateFoundEnabled) events.push('watching.update_found');
  if (settings.watchingUpdateFailedEnabled)
    events.push('watching.update_failed');
  return events;
}

function normalizeConfigForForm(
  provider: NotificationProviderMeta,
  source: Record<string, unknown>,
) {
  return provider.configSchema.fields.reduce<Record<string, string>>(
    (config, field) => {
      const value = source[field.key];
      config[field.key] =
        typeof value === 'string'
          ? value
          : (provider.defaultConfig[field.key] ?? '');
      return config;
    },
    {},
  );
}

function buildCreateForm(provider: NotificationProviderMeta): ChannelFormState {
  return {
    mode: 'create',
    providerType: provider.type,
    name: provider.defaultName,
    subscribedEvents: [...DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS],
    config: { ...provider.defaultConfig },
    originalConfig: {},
  };
}

function buildEditForm(
  channel: NotificationChannelConfig,
  settings: NotificationSettings,
): ChannelFormState {
  const provider = getNotificationProviderMeta(channel.type);
  const config = normalizeConfigForForm(provider, channel.config);
  return {
    mode: 'edit',
    channelId: channel.id,
    providerType: channel.type,
    name: channel.name,
    subscribedEvents: getCompatibleSubscribedEvents(channel, settings),
    config,
    originalConfig: config,
  };
}

function toggleEventSubscription(events: string[], eventType: string) {
  const next = new Set(events);
  if (next.has(eventType)) next.delete(eventType);
  else next.add(eventType);
  return Array.from(next);
}

function hasConfigPatch(form: ChannelFormState) {
  const provider = getNotificationProviderMeta(form.providerType);
  return provider.configSchema.fields.some(
    (field) => form.config[field.key] !== form.originalConfig[field.key],
  );
}

function buildConfigPatch(form: ChannelFormState) {
  const provider = getNotificationProviderMeta(form.providerType);
  return provider.configSchema.fields.reduce<Record<string, string>>(
    (patch, field) => {
      const nextValue = form.config[field.key] ?? '';
      if (
        form.mode === 'create' ||
        nextValue !== form.originalConfig[field.key]
      ) {
        patch[field.key] = nextValue;
      }
      return patch;
    },
    {},
  );
}

function isFormValid(form: ChannelFormState) {
  const provider = getNotificationProviderMeta(form.providerType);
  if (!form.name.trim()) return false;
  return provider.configSchema.fields.every((field) => {
    if (!field.required) return true;
    return Boolean((form.config[field.key] ?? '').trim());
  });
}

function formatTestTime(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationSettingsPage({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channelSavingId, setChannelSavingId] = useState<string | null>(null);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [form, setForm] = useState<ChannelFormState | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, ChannelTestResult>
  >({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [canManageSettings, setCanManageSettings] = useState(false);

  const creatableProviders = useMemo(
    () => getCreatableNotificationProviderMetas(),
    [],
  );

  useEffect(() => {
    const auth = getAuthInfoFromBrowserCookie();
    setCanManageSettings(isAdminRole(auth?.role));
    setAuthChecked(true);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(NOTIFICATION_SETTINGS_ENDPOINT, {
        cache: 'no-store',
      });
      const data = await readSettingsResponse(response);
      setSettings(data.settings);
      setForm(null);
      setProviderPickerOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知设置请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!canManageSettings) {
      setLoading(false);
      setSettings(null);
      return;
    }
    void loadSettings();
  }, [authChecked, canManageSettings, loadSettings]);

  const applySettings = (next: NotificationSettings) => {
    setSettings(next);
    setForm(null);
    setProviderPickerOpen(false);
  };

  const restoreDefault = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(NOTIFICATION_SETTINGS_ENDPOINT, {
        method: 'DELETE',
      });
      const data = await readSettingsResponse(response);
      applySettings(data.settings);
      setMessage('已恢复默认通知设置');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复默认失败');
    } finally {
      setSaving(false);
    }
  };

  const saveChannelForm = async () => {
    if (!form || !isFormValid(form)) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const configPatch = buildConfigPatch(form);
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        subscribedEvents: form.subscribedEvents,
      };
      if (form.mode === 'create') {
        body.type = form.providerType;
        body.config = configPatch;
      } else if (hasConfigPatch(form)) {
        body.config = configPatch;
      }
      const response = await fetch(
        form.mode === 'create'
          ? NOTIFICATION_CHANNELS_ENDPOINT
          : `${NOTIFICATION_CHANNELS_ENDPOINT}/${form.channelId}`,
        {
          method: form.mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await readSettingsResponse(response);
      applySettings(data.settings);
      setMessage(form.mode === 'create' ? '通知方式已添加' : '通知方式已更新');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : form.mode === 'create'
            ? '通知方式添加失败'
            : '通知方式更新失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const updateChannel = async (
    channel: NotificationChannelConfig,
    patch: Record<string, unknown>,
  ) => {
    setChannelSavingId(channel.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${NOTIFICATION_CHANNELS_ENDPOINT}/${channel.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      );
      const data = await readSettingsResponse(response);
      applySettings(data.settings);
      setMessage('通知方式已更新');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知方式更新失败');
    } finally {
      setChannelSavingId(null);
    }
  };

  const deleteChannel = async (channel: NotificationChannelConfig) => {
    setChannelSavingId(channel.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${NOTIFICATION_CHANNELS_ENDPOINT}/${channel.id}`,
        {
          method: 'DELETE',
        },
      );
      const data = await readSettingsResponse(response);
      applySettings(data.settings);
      setMessage('通知方式已删除');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知方式删除失败');
    } finally {
      setChannelSavingId(null);
    }
  };

  const sendTest = async (channel: NotificationChannelConfig) => {
    setChannelSavingId(channel.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(NOTIFICATION_TEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id }),
      });
      await readSettingsResponse(response);
      setTestResults((current) => ({
        ...current,
        [channel.id]: {
          status: 'success',
          message: '测试通知已发送',
          time: Date.now(),
        },
      }));
      setMessage('测试通知已发送');
    } catch (reason) {
      const reasonMessage =
        reason instanceof Error ? reason.message : '测试通知发送失败';
      setTestResults((current) => ({
        ...current,
        [channel.id]: {
          status: 'error',
          message: reasonMessage,
          time: Date.now(),
        },
      }));
      setError(reasonMessage);
    } finally {
      setChannelSavingId(null);
    }
  };

  const openCreateForm = (provider: NotificationProviderMeta) => {
    if (!provider.capabilities.canCreate) return;
    setForm(buildCreateForm(provider));
    setProviderPickerOpen(false);
    setMessage(null);
    setError(null);
  };

  const openEditForm = (channel: NotificationChannelConfig) => {
    if (!settings) return;
    const provider = getNotificationProviderMeta(channel.type);
    if (!provider.capabilities.canEdit) return;
    setForm(buildEditForm(channel, settings));
    setProviderPickerOpen(false);
    setMessage(null);
    setError(null);
  };

  const renderChannelForm = () => {
    if (!form) return null;
    const provider = getNotificationProviderMeta(form.providerType);
    const Icon = provider.icon;
    const title = form.mode === 'create' ? '添加通知方式' : '编辑通知方式';

    return (
      <section className='rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex items-start gap-3'>
            <span className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'>
              <Icon className='h-5 w-5' />
            </span>
            <div>
              <h3 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                {title} · {provider.displayName}
              </h3>
              <p className='mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400'>
                配置项由 Provider Schema 统一驱动；事件订阅保存到当前通知方式的
                subscribedEvents。
              </p>
            </div>
          </div>
          <button
            type='button'
            onClick={() => setForm(null)}
            disabled={saving}
            className='inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-white hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200'
            aria-label='关闭配置'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
          <label className='flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200'>
            渠道名称
            <input
              aria-label='渠道名称'
              value={form.name}
              disabled={saving}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
              className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
            />
          </label>

          {provider.configSchema.fields.map((field) => (
            <label
              key={field.key}
              className='flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200'
            >
              {field.label}
              <input
                aria-label={field.label}
                type={field.type}
                required={field.required}
                value={form.config[field.key] ?? ''}
                disabled={saving}
                onChange={(event) =>
                  setForm((current) =>
                    current
                      ? {
                          ...current,
                          config: {
                            ...current.config,
                            [field.key]: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                placeholder={field.placeholder}
                className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
              />
              {field.description && (
                <span className='text-xs font-normal leading-5 text-gray-500 dark:text-gray-400'>
                  {field.description}
                </span>
              )}
            </label>
          ))}
        </div>

        <div className='mt-5 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950/60'>
          <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            订阅事件
          </div>
          <div className='mt-3 grid gap-2 md:grid-cols-2'>
            {NOTIFICATION_EVENT_METAS.map((eventMeta) => {
              const checked = form.subscribedEvents.includes(eventMeta.type);
              return (
                <label
                  key={eventMeta.type}
                  className='flex items-start gap-3 rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800'
                >
                  <input
                    type='checkbox'
                    aria-label={eventMeta.label}
                    checked={checked}
                    disabled={saving}
                    onChange={() =>
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              subscribedEvents: toggleEventSubscription(
                                current.subscribedEvents,
                                eventMeta.type,
                              ),
                            }
                          : current,
                      )
                    }
                    className='mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-gray-700 dark:bg-gray-950'
                  />
                  <span>
                    <span className='block font-medium text-gray-800 dark:text-gray-100'>
                      {eventMeta.label}
                    </span>
                    <span className='mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                      {eventMeta.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className='mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end'>
          <button
            type='button'
            disabled={saving}
            onClick={() => setForm(null)}
            className='rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
          >
            取消
          </button>
          <button
            type='button'
            disabled={saving || !isFormValid(form)}
            onClick={saveChannelForm}
            className='inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
          >
            {saving && <LoaderCircle className='h-4 w-4 animate-spin' />}
            保存通知方式
          </button>
        </div>
      </section>
    );
  };

  return (
    <main
      className={
        embedded
          ? 'text-gray-900 dark:text-gray-100'
          : 'min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100'
      }
    >
      <div
        className={
          embedded
            ? 'flex w-full flex-col gap-4'
            : 'mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8'
        }
      >
        <header className='border-b border-gray-200 pb-4 dark:border-gray-800'>
          <div className='flex items-center gap-3'>
            <span className='inline-flex h-10 w-10 items-center justify-center rounded-md bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'>
              <CheckCircle2 className='h-5 w-5' />
            </span>
            <div>
              <h1
                className={
                  embedded
                    ? 'text-lg font-semibold tracking-normal'
                    : 'text-2xl font-semibold tracking-normal'
                }
              >
                通知设置
              </h1>
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                以通知方式为单位管理启停、测试和事件订阅
              </p>
            </div>
          </div>
        </header>

        {loading && (
          <div className='flex items-center gap-2 rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'>
            <LoaderCircle className='h-4 w-4 animate-spin' />
            正在加载通知设置
          </div>
        )}

        {!loading && !canManageSettings && (
          <div className='rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'>
            通知设置仅管理员可见。普通用户仍可在通知中心查看自己的通知列表。
          </div>
        )}

        {error && (
          <div className='rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'>
            {error}
          </div>
        )}

        {message && (
          <div className='flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'>
            <Check className='h-4 w-4' />
            {message}
          </div>
        )}

        {settings && canManageSettings && (
          <>
            <section className='space-y-3'>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <h2 className='text-base font-semibold'>通知方式</h2>
                  <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                    每个通知方式独立配置、独立启停，并订阅自己需要接收的事件。
                  </p>
                </div>
                <button
                  type='button'
                  onClick={() => {
                    setProviderPickerOpen((open) => !open);
                    setForm(null);
                  }}
                  disabled={saving}
                  className='inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                >
                  <MessageSquarePlus className='h-4 w-4' />
                  添加通知方式
                </button>
              </div>

              {providerPickerOpen && (
                <div className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900'>
                  <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                    选择通知方式
                  </div>
                  <p className='mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400'>
                    先选择 Provider，再进入对应 Schema
                    生成的配置界面，避免把所有渠道字段堆在同一张表单。
                  </p>
                  <div className='mt-3 grid gap-3 md:grid-cols-2'>
                    {NOTIFICATION_PROVIDER_METAS.map((provider) => {
                      const Icon = provider.icon;
                      const disabled = !provider.capabilities.canCreate;
                      return (
                        <button
                          key={provider.type}
                          type='button'
                          disabled={saving || disabled}
                          onClick={() => openCreateForm(provider)}
                          className='flex items-start gap-3 rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
                        >
                          <span className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'>
                            <Icon className='h-5 w-5' />
                          </span>
                          <span className='min-w-0'>
                            <span className='block text-sm font-semibold text-gray-900 dark:text-gray-100'>
                              {provider.displayName}
                            </span>
                            <span className='mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                              {provider.description}
                            </span>
                            {disabled && (
                              <span className='mt-2 inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400'>
                                系统默认或暂不可新增
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {creatableProviders.length === 0 && (
                    <p className='mt-3 text-xs text-gray-500 dark:text-gray-400'>
                      当前没有可新增的通知方式。
                    </p>
                  )}
                </div>
              )}

              {renderChannelForm()}

              <div className='grid gap-3'>
                {settings.channels.map((channel) => {
                  const provider = getNotificationProviderMeta(channel.type);
                  const Icon = provider.icon;
                  const pending = channelSavingId === channel.id;
                  const subscribedEvents = getCompatibleSubscribedEvents(
                    channel,
                    settings,
                  );
                  const testResult = testResults[channel.id];
                  return (
                    <article
                      key={channel.id}
                      className='rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900'
                    >
                      <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                        <div className='flex min-w-0 gap-3'>
                          <span className='inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'>
                            <Icon className='h-5 w-5' />
                          </span>
                          <div className='min-w-0'>
                            <div className='flex flex-wrap items-center gap-2'>
                              <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                                {provider.displayName}
                              </h3>
                              <span className='rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300'>
                                {channel.name}
                              </span>
                              <span
                                className={`rounded-md px-2 py-0.5 text-xs ${
                                  channel.enabled
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                }`}
                              >
                                {channel.enabled ? '启用' : '关闭'}
                              </span>
                            </div>
                            <p className='mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400'>
                              {provider.description}
                            </p>
                          </div>
                        </div>

                        <div className='flex flex-wrap items-center gap-2'>
                          {provider.capabilities.canToggle && (
                            <label className='inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 dark:border-gray-700 dark:text-gray-200'>
                              <input
                                type='checkbox'
                                role='switch'
                                aria-label={`启停 ${channel.name}`}
                                checked={channel.enabled}
                                disabled={pending || saving}
                                onChange={() =>
                                  updateChannel(channel, {
                                    enabled: !channel.enabled,
                                  })
                                }
                                className='h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-gray-700 dark:bg-gray-950'
                              />
                              {channel.enabled ? '关闭' : '启用'}
                            </label>
                          )}
                          {provider.capabilities.canTest && (
                            <button
                              type='button'
                              disabled={pending || saving || !channel.enabled}
                              onClick={() => sendTest(channel)}
                              className='rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                            >
                              {pending ? '处理中' : '测试'}
                            </button>
                          )}
                          {provider.capabilities.canEdit && (
                            <button
                              type='button'
                              disabled={pending || saving}
                              onClick={() => openEditForm(channel)}
                              className='inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                            >
                              <Edit3 className='h-3.5 w-3.5' />
                              编辑
                            </button>
                          )}
                          {provider.capabilities.canDelete && (
                            <button
                              type='button'
                              disabled={pending || saving}
                              onClick={() => deleteChannel(channel)}
                              className='inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30'
                            >
                              <Trash2 className='h-3.5 w-3.5' />
                              删除
                            </button>
                          )}
                        </div>
                      </div>

                      <div className='mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'>
                        <div className='rounded-md border border-gray-200 p-3 dark:border-gray-800'>
                          <div className='text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                            订阅事件
                          </div>
                          <div className='mt-3 grid gap-2 sm:grid-cols-2'>
                            {NOTIFICATION_EVENT_METAS.map((eventMeta) => {
                              const enabled = subscribedEvents.includes(
                                eventMeta.type,
                              );
                              return (
                                <div
                                  key={eventMeta.type}
                                  className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200'
                                >
                                  {enabled ? (
                                    <Check className='h-4 w-4 text-emerald-500' />
                                  ) : (
                                    <X className='h-4 w-4 text-gray-400' />
                                  )}
                                  <span>{eventMeta.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className='rounded-md border border-gray-200 p-3 dark:border-gray-800'>
                          <div className='text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                            最近测试结果
                          </div>
                          <div className='mt-3 text-sm text-gray-700 dark:text-gray-200'>
                            {testResult ? (
                              <div
                                className={
                                  testResult.status === 'success'
                                    ? 'text-emerald-600 dark:text-emerald-300'
                                    : 'text-red-600 dark:text-red-300'
                                }
                              >
                                <div>{testResult.message}</div>
                                <div className='mt-1 text-xs opacity-80'>
                                  {formatTestTime(testResult.time)}
                                </div>
                              </div>
                            ) : (
                              <span className='text-gray-500 dark:text-gray-400'>
                                暂无测试记录
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className='flex flex-col gap-2 border-t border-gray-200 pt-5 dark:border-gray-800 sm:flex-row sm:justify-end'>
              <button
                type='button'
                onClick={restoreDefault}
                disabled={saving}
                className='inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
              >
                <RotateCcw className='h-4 w-4' />
                恢复默认
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
