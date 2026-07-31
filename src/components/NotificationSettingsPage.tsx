'use client';

import {
  BellRing,
  Check,
  Edit3,
  Layers3,
  LoaderCircle,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import {
  DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS,
  NOTIFICATION_EVENT_METAS,
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

type ChannelModalStep = 'provider' | 'config';

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
  if (!form.name.trim()) return false;
  const provider = getNotificationProviderMeta(form.providerType);
  return provider.configSchema.fields.every((field) => {
    if (!field.required) return true;
    return Boolean(form.config[field.key]?.trim());
  });
}

function formatUpdatedAt(timestamp?: number) {
  if (!timestamp) return null;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);
  } catch {
    return null;
  }
}

function mergeClassName(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function ToggleSwitch({
  checked,
  disabled,
  label,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={mergeClassName(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-950',
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700',
      )}
    >
      <span
        className={mergeClassName(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
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
  const [channelModalStep, setChannelModalStep] =
    useState<ChannelModalStep | null>(null);
  const [form, setForm] = useState<ChannelFormState | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [canManageSettings, setCanManageSettings] = useState(false);

  const creatableProviders = useMemo(
    () => getCreatableNotificationProviderMetas(),
    [],
  );

  const enabledChannelCount = useMemo(
    () => settings?.channels.filter((channel) => channel.enabled).length ?? 0,
    [settings],
  );
  const globalPushEnabled = enabledChannelCount > 0;
  const allSelected =
    settings !== null &&
    settings.channels.length > 0 &&
    selectedChannelIds.length === settings.channels.length;
  const selectedChannels = useMemo(
    () =>
      settings?.channels.filter((channel) =>
        selectedChannelIds.includes(channel.id),
      ) ?? [],
    [selectedChannelIds, settings],
  );
  const selectedDeletableChannels = selectedChannels.filter(
    (channel) =>
      getNotificationProviderMeta(channel.type).capabilities.canDelete,
  );

  useEffect(() => {
    const auth = getAuthInfoFromBrowserCookie();
    setCanManageSettings(isAdminRole(auth?.role));
    setAuthChecked(true);
  }, []);

  const closeChannelModal = useCallback(() => {
    setChannelModalStep(null);
    setForm(null);
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
      closeChannelModal();
      setBatchMode(false);
      setSelectedChannelIds([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知设置请求失败');
    } finally {
      setLoading(false);
    }
  }, [closeChannelModal]);

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
    closeChannelModal();
    setSelectedChannelIds((current) =>
      current.filter((id) =>
        next.channels.some((channel) => channel.id === id),
      ),
    );
  };

  const patchChannel = async (
    channel: NotificationChannelConfig,
    patch: Record<string, unknown>,
  ) => {
    const response = await fetch(
      `${NOTIFICATION_CHANNELS_ENDPOINT}/${channel.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    const data = await readSettingsResponse(response);
    return data.settings;
  };

  const updateChannel = async (
    channel: NotificationChannelConfig,
    patch: Record<string, unknown>,
    successMessage = '通知渠道已更新',
  ) => {
    setChannelSavingId(channel.id);
    setError(null);
    setMessage(null);
    try {
      const nextSettings = await patchChannel(channel, patch);
      applySettings(nextSettings);
      setMessage(successMessage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知渠道更新失败');
    } finally {
      setChannelSavingId(null);
    }
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
      setBatchMode(false);
      setSelectedChannelIds([]);
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
      setMessage(form.mode === 'create' ? '通知渠道已添加' : '通知渠道已更新');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : form.mode === 'create'
            ? '通知渠道添加失败'
            : '通知渠道更新失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteChannel = async (channel: NotificationChannelConfig) => {
    setChannelSavingId(channel.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${NOTIFICATION_CHANNELS_ENDPOINT}/${channel.id}`,
        { method: 'DELETE' },
      );
      const data = await readSettingsResponse(response);
      applySettings(data.settings);
      setMessage('通知渠道已删除');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知渠道删除失败');
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
      setMessage('测试通知已发送');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '测试通知发送失败');
    } finally {
      setChannelSavingId(null);
    }
  };

  const openAddChannel = () => {
    setForm(null);
    setChannelModalStep('provider');
    setMessage(null);
    setError(null);
  };

  const openCreateForm = (providerType: string) => {
    const provider = getNotificationProviderMeta(providerType);
    if (!provider.capabilities.canCreate) return;
    setForm(buildCreateForm(provider));
    setChannelModalStep('config');
  };

  const openEditForm = (channel: NotificationChannelConfig) => {
    if (!settings) return;
    const provider = getNotificationProviderMeta(channel.type);
    if (!provider.capabilities.canEdit) return;
    setForm(buildEditForm(channel, settings));
    setChannelModalStep('config');
    setMessage(null);
    setError(null);
  };

  const toggleGlobalPush = async () => {
    if (!settings || saving) return;
    const nextEnabled = !globalPushEnabled;
    const togglableChannels = settings.channels.filter(
      (channel) =>
        getNotificationProviderMeta(channel.type).capabilities.canToggle,
    );
    if (togglableChannels.length === 0) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      let nextSettings = settings;
      for (const channel of togglableChannels) {
        nextSettings = await patchChannel(channel, { enabled: nextEnabled });
      }
      applySettings(nextSettings);
      setMessage(nextEnabled ? '已启用全部通知渠道' : '已关闭全部通知渠道');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '推送总开关更新失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleBatchMode = () => {
    setBatchMode((current) => !current);
    setSelectedChannelIds([]);
  };

  const toggleSelectAll = () => {
    if (!settings) return;
    setSelectedChannelIds((current) =>
      current.length === settings.channels.length
        ? []
        : settings.channels.map((channel) => channel.id),
    );
  };

  const toggleChannelSelection = (channelId: string) => {
    setSelectedChannelIds((current) =>
      current.includes(channelId)
        ? current.filter((id) => id !== channelId)
        : [...current, channelId],
    );
  };

  const runBatchPatch = async (patch: Record<string, unknown>) => {
    if (selectedChannels.length === 0) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      let nextSettings = settings;
      for (const channel of selectedChannels) {
        if (!nextSettings) break;
        nextSettings = await patchChannel(channel, patch);
      }
      if (nextSettings) applySettings(nextSettings);
      setMessage('批量操作已完成');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量操作失败');
    } finally {
      setSaving(false);
    }
  };

  const runBatchDelete = async () => {
    if (selectedDeletableChannels.length === 0) {
      setMessage('没有可删除的通知渠道');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      let nextSettings = settings;
      for (const channel of selectedDeletableChannels) {
        const response = await fetch(
          `${NOTIFICATION_CHANNELS_ENDPOINT}/${channel.id}`,
          { method: 'DELETE' },
        );
        const data = await readSettingsResponse(response);
        nextSettings = data.settings;
      }
      if (nextSettings) applySettings(nextSettings);
      setMessage('批量删除已完成');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量删除失败');
    } finally {
      setSaving(false);
    }
  };

  const renderProviderPicker = () => (
    <div className='grid gap-3 sm:grid-cols-2'>
      {creatableProviders.map((provider) => {
        const Icon = provider.icon;
        return (
          <button
            key={provider.type}
            type='button'
            disabled={saving}
            onClick={() => openCreateForm(provider.type)}
            className='group flex min-h-24 items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
          >
            <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300'>
              <Icon className='h-5 w-5' />
            </span>
            <span className='min-w-0'>
              <span className='block text-sm font-semibold text-gray-900 dark:text-gray-100'>
                {provider.displayName}
              </span>
              <span className='mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                {provider.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const renderChannelForm = () => {
    if (!form) return null;
    const provider = getNotificationProviderMeta(form.providerType);
    const Icon = provider.icon;
    const valid = isFormValid(form);
    return (
      <div className='space-y-5'>
        <div className='flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/60'>
          <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'>
            <Icon className='h-5 w-5' />
          </span>
          <div>
            <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
              {provider.displayName}
            </div>
            <div className='text-xs text-gray-500 dark:text-gray-400'>
              {provider.description}
            </div>
          </div>
        </div>

        <section className='space-y-3'>
          <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
            基础信息
          </h4>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-200'>
            渠道名称
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
              className='mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
              placeholder='例如：服务器通知'
            />
          </label>
        </section>

        <section className='space-y-3'>
          <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
            Provider配置
          </h4>
          {provider.configSchema.fields.length === 0 ? (
            <div className='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
              当前通知方式无需额外配置。
            </div>
          ) : (
            <div className='space-y-3'>
              {provider.configSchema.fields.map((field) => (
                <label
                  key={field.key}
                  className='block text-sm font-medium text-gray-700 dark:text-gray-200'
                >
                  {field.label}
                  {field.required && <span className='text-red-500'> *</span>}
                  <input
                    type={field.type === 'password' ? 'password' : 'text'}
                    inputMode={field.type === 'url' ? 'url' : undefined}
                    value={form.config[field.key] ?? ''}
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
                    className='mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                    placeholder={field.placeholder}
                  />
                  {field.description && (
                    <span className='mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                      {field.description}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </section>

        {form.mode === 'edit' && (
          <section className='space-y-3'>
            <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
              通知事件
            </h4>
            <div className='grid gap-2 sm:grid-cols-2'>
              {NOTIFICATION_EVENT_METAS.map((eventMeta) => {
                const checked = form.subscribedEvents.includes(eventMeta.type);
                return (
                  <label
                    key={eventMeta.type}
                    className='flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
                  >
                    <input
                      type='checkbox'
                      checked={checked}
                      aria-label={eventMeta.label}
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
                      className='mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700'
                    />
                    <span>
                      <span className='block font-medium text-gray-800 dark:text-gray-100'>
                        {eventMeta.label}
                      </span>
                      <span className='mt-0.5 block text-xs text-gray-500 dark:text-gray-400'>
                        {eventMeta.type}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        )}

        <div className='flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end'>
          {form.mode === 'create' && (
            <button
              type='button'
              disabled={saving}
              onClick={() => {
                setForm(null);
                setChannelModalStep('provider');
              }}
              className='rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
            >
              重新选择
            </button>
          )}
          <button
            type='button'
            disabled={saving}
            onClick={closeChannelModal}
            className='rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
          >
            取消
          </button>
          <button
            type='button'
            disabled={saving || !valid}
            onClick={() => void saveChannelForm()}
            className='inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'
          >
            {saving && <LoaderCircle className='h-4 w-4 animate-spin' />}
            保存
          </button>
        </div>
      </div>
    );
  };

  const renderChannelModal = () => {
    if (!channelModalStep) return null;
    const title =
      channelModalStep === 'provider'
        ? '选择通知渠道'
        : form?.mode === 'edit'
          ? '编辑通知渠道'
          : '配置通知渠道';
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm'>
        <div className='max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950'>
          <div className='flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800'>
            <div>
              <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                {title}
              </h3>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                {channelModalStep === 'provider'
                  ? '选择一种通知方式，点击卡片后直接进入配置。'
                  : '列表保持简洁，详细配置统一在弹窗中维护。'}
              </p>
            </div>
            <button
              type='button'
              aria-label='关闭'
              disabled={saving}
              onClick={closeChannelModal}
              className='rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100'
            >
              <X className='h-5 w-5' />
            </button>
          </div>
          <div className='max-h-[calc(88vh-5rem)] overflow-y-auto p-5'>
            {channelModalStep === 'provider'
              ? renderProviderPicker()
              : renderChannelForm()}
          </div>
        </div>
      </div>
    );
  };

  const renderNotificationConfig = () => (
    <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950/80'>
      <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
        <div>
          <div className='flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100'>
            <BellRing className='h-5 w-5 text-blue-600 dark:text-blue-400' />
            通知配置
          </div>
          <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            管理推送总开关、通知渠道与默认配置。
          </p>
        </div>
        <div className='flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60'>
          <div className='text-right'>
            <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
              推送总开关
            </div>
            <div className='text-xs text-gray-500 dark:text-gray-400'>
              {globalPushEnabled ? 'ON' : 'OFF'}
            </div>
          </div>
          <ToggleSwitch
            checked={globalPushEnabled}
            disabled={saving || loading || !settings?.channels.length}
            label='推送总开关'
            onClick={() => void toggleGlobalPush()}
          />
        </div>
      </div>

      <div className='mt-5 flex flex-wrap gap-2'>
        <button
          type='button'
          disabled={saving || loading}
          onClick={openAddChannel}
          className='inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'
        >
          <MessageSquarePlus className='h-4 w-4' />
          添加通知渠道
        </button>
        <button
          type='button'
          disabled={saving || loading || !settings?.channels.length}
          onClick={toggleBatchMode}
          className='inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
        >
          <Layers3 className='h-4 w-4' />
          {batchMode ? '退出批量管理' : '批量管理'}
        </button>
        <button
          type='button'
          disabled={saving || loading}
          onClick={() => void restoreDefault()}
          className='inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
        >
          <RotateCcw className='h-4 w-4' />
          恢复默认
        </button>
      </div>
    </section>
  );

  const renderBatchToolbar = () => {
    if (!batchMode) return null;
    return (
      <div className='mb-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/20 md:flex-row md:items-center md:justify-between'>
        <div>
          <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
            批量管理
          </div>
          <div className='text-xs text-gray-500 dark:text-gray-400'>
            已选择 {selectedChannelIds.length} 项
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            disabled={saving || !settings?.channels.length}
            onClick={toggleSelectAll}
            className='rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
          <button
            type='button'
            disabled={saving || selectedChannels.length === 0}
            onClick={() => void runBatchPatch({ enabled: true })}
            className='rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
          >
            启用
          </button>
          <button
            type='button'
            disabled={saving || selectedChannels.length === 0}
            onClick={() => void runBatchPatch({ enabled: false })}
            className='rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
          >
            关闭
          </button>
          <button
            type='button'
            disabled={saving || selectedDeletableChannels.length === 0}
            onClick={() => void runBatchDelete()}
            className='rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:bg-gray-950 dark:text-red-300 dark:hover:bg-red-950/30'
          >
            删除
          </button>
          <button
            type='button'
            disabled={saving}
            onClick={toggleBatchMode}
            className='rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
          >
            退出
          </button>
        </div>
      </div>
    );
  };

  const renderChannelList = () => (
    <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950/80'>
      <div className='mb-4 flex items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            通知渠道
          </h2>
          <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            管理已创建的通知渠道。
          </p>
        </div>
        {settings?.updatedAt && (
          <span className='hidden rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400 sm:inline-flex'>
            更新于 {formatUpdatedAt(settings.updatedAt)}
          </span>
        )}
      </div>

      {renderBatchToolbar()}

      {!settings || settings.channels.length === 0 ? (
        <div className='rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
          暂无通知渠道，请先添加一个通知渠道。
        </div>
      ) : (
        <div className='space-y-3'>
          {settings.channels.map((channel) => {
            const provider = getNotificationProviderMeta(channel.type);
            const Icon = provider.icon;
            const pending = channelSavingId === channel.id;
            const selected = selectedChannelIds.includes(channel.id);
            return (
              <article
                key={channel.id}
                className={mergeClassName(
                  'flex min-h-24 items-center gap-3 rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm dark:bg-gray-950',
                  selected
                    ? 'border-blue-300 ring-2 ring-blue-500/20 dark:border-blue-700'
                    : 'border-gray-200 dark:border-gray-800',
                )}
              >
                {batchMode && (
                  <input
                    type='checkbox'
                    checked={selected}
                    aria-label={`选择 ${channel.name}`}
                    disabled={saving}
                    onChange={() => toggleChannelSelection(channel.id)}
                    className='h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700'
                  />
                )}

                <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'>
                  <Icon className='h-5 w-5' />
                </span>

                <div className='min-w-0 flex-1'>
                  <h3 className='truncate text-base font-semibold text-gray-900 dark:text-gray-100'>
                    {channel.name}
                  </h3>
                  <p className='mt-1 truncate text-sm text-gray-500 dark:text-gray-400'>
                    {provider.displayName}
                  </p>
                </div>

                <div className='flex flex-col items-end gap-3 sm:flex-row sm:items-center'>
                  <div className='flex items-center gap-2'>
                    <span
                      className={mergeClassName(
                        'text-xs font-medium',
                        channel.enabled
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-500 dark:text-gray-400',
                      )}
                    >
                      {channel.enabled ? '启用' : '关闭'}
                    </span>
                    {provider.capabilities.canToggle && (
                      <ToggleSwitch
                        checked={channel.enabled}
                        disabled={pending || saving}
                        label={`启停 ${channel.name}`}
                        onClick={() =>
                          void updateChannel(channel, {
                            enabled: !channel.enabled,
                          })
                        }
                      />
                    )}
                  </div>

                  {!batchMode && (
                    <div className='flex flex-wrap justify-end gap-2'>
                      {provider.capabilities.canTest && (
                        <button
                          type='button'
                          disabled={pending || saving || !channel.enabled}
                          onClick={() => void sendTest(channel)}
                          className='inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                        >
                          {pending ? (
                            <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
                          ) : (
                            <Send className='h-3.5 w-3.5' />
                          )}
                          测试
                        </button>
                      )}
                      {provider.capabilities.canEdit && (
                        <button
                          type='button'
                          disabled={pending || saving}
                          onClick={() => openEditForm(channel)}
                          className='inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                        >
                          <Edit3 className='h-3.5 w-3.5' />
                          编辑
                        </button>
                      )}
                      {provider.capabilities.canDelete && (
                        <button
                          type='button'
                          disabled={pending || saving}
                          onClick={() => void deleteChannel(channel)}
                          className='inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30'
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                          删除
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  const content = (
    <div className='space-y-5'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold text-gray-900 dark:text-gray-100'>
            通知设置
          </h1>
          <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            管理通知推送渠道。
          </p>
        </div>
        {loading && (
          <span className='inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400'>
            <LoaderCircle className='h-3 w-3 animate-spin' />
            正在加载通知设置
          </span>
        )}
      </div>

      {message && (
        <div className='flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300'>
          <Check className='h-4 w-4' />
          {message}
        </div>
      )}
      {error && (
        <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'>
          {error}
        </div>
      )}

      {!authChecked || loading ? (
        <div className='rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-950/80 dark:text-gray-400'>
          正在加载通知设置
        </div>
      ) : !canManageSettings ? (
        <div className='rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-950/80 dark:text-gray-400'>
          通知设置仅管理员可见。
        </div>
      ) : (
        <>
          {renderNotificationConfig()}
          {renderChannelList()}
        </>
      )}

      {renderChannelModal()}
    </div>
  );

  if (embedded) return content;

  return (
    <main className='min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-950 sm:px-6 lg:px-8'>
      <div className='mx-auto max-w-5xl'>{content}</div>
    </main>
  );
}
