'use client';

import {
  BellRing,
  Check,
  CheckCircle2,
  ChevronRight,
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

function getProviderTone() {
  return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300';
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
  const [selectedProviderType, setSelectedProviderType] = useState<
    string | null
  >(null);
  const [form, setForm] = useState<ChannelFormState | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
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
    setSelectedProviderType(null);
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
      };
      if (form.mode === 'create') {
        body.type = form.providerType;
        body.subscribedEvents = form.subscribedEvents;
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
    successMessage = '通知方式已更新',
  ) => {
    setChannelSavingId(channel.id);
    setError(null);
    setMessage(null);
    try {
      const nextSettings = await patchChannel(channel, patch);
      applySettings(nextSettings);
      setMessage(successMessage);
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

  const openAddChannel = () => {
    setSelectedProviderType(creatableProviders[0]?.type ?? null);
    setForm(null);
    setChannelModalStep('provider');
    setMessage(null);
    setError(null);
  };

  const openCreateForm = () => {
    if (!selectedProviderType) return;
    const provider = getNotificationProviderMeta(selectedProviderType);
    if (!provider.capabilities.canCreate) return;
    setForm(buildCreateForm(provider));
    setChannelModalStep('config');
  };

  const openEditForm = (channel: NotificationChannelConfig) => {
    if (!settings) return;
    const provider = getNotificationProviderMeta(channel.type);
    if (!provider.capabilities.canEdit) return;
    setSelectedProviderType(channel.type);
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

  const clearSelection = () => setSelectedChannelIds([]);

  const toggleChannelSelection = (channelId: string) => {
    setSelectedChannelIds((current) =>
      current.includes(channelId)
        ? current.filter((id) => id !== channelId)
        : [...current, channelId],
    );
  };

  const batchPatchChannels = async (enabled: boolean) => {
    if (!settings || selectedChannels.length === 0) return;
    const targets = selectedChannels.filter(
      (channel) =>
        getNotificationProviderMeta(channel.type).capabilities.canToggle,
    );
    if (targets.length === 0) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      let nextSettings = settings;
      for (const channel of targets) {
        nextSettings = await patchChannel(channel, { enabled });
      }
      applySettings(nextSettings);
      setMessage(enabled ? '已批量启用通知渠道' : '已批量禁用通知渠道');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量更新失败');
    } finally {
      setSaving(false);
    }
  };

  const batchDeleteChannels = async () => {
    if (!settings || selectedDeletableChannels.length === 0) return;

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
      applySettings(nextSettings);
      setSelectedChannelIds([]);
      setMessage('已批量删除可删除的通知渠道');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量删除失败');
    } finally {
      setSaving(false);
    }
  };

  const renderModal = () => {
    if (!channelModalStep) return null;
    const provider = form
      ? getNotificationProviderMeta(form.providerType)
      : selectedProviderType
        ? getNotificationProviderMeta(selectedProviderType)
        : null;
    const ProviderIcon = provider?.icon;

    return (
      <div
        className='fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm'
        role='dialog'
        aria-modal='true'
        aria-label={form?.mode === 'edit' ? '编辑通知渠道' : '添加通知渠道'}
      >
        <div className='w-full max-w-xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950'>
          <div className='flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800'>
            <div>
              <div className='flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100'>
                {ProviderIcon && (
                  <span className='inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'>
                    <ProviderIcon className='h-4 w-4' />
                  </span>
                )}
                {form?.mode === 'edit' ? '编辑渠道' : '添加渠道'}
              </div>
              <p className='mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400'>
                {channelModalStep === 'provider'
                  ? '先选择 Provider，再进入基础配置。事件订阅可在渠道卡片内调整。'
                  : '仅配置名称和 Provider 基础字段；事件订阅与测试结果不会出现在弹窗中。'}
              </p>
            </div>
            <button
              type='button'
              onClick={closeChannelModal}
              disabled={saving}
              className='rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200'
              aria-label='关闭弹窗'
            >
              <X className='h-4 w-4' />
            </button>
          </div>

          {channelModalStep === 'provider' ? (
            <div className='p-5'>
              <div className='mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                选择 Provider
              </div>
              <div className='grid gap-3'>
                {NOTIFICATION_PROVIDER_METAS.map((providerMeta) => {
                  const Icon = providerMeta.icon;
                  const active = selectedProviderType === providerMeta.type;
                  const creatable = providerMeta.capabilities.canCreate;
                  return (
                    <button
                      key={providerMeta.type}
                      type='button'
                      disabled={!creatable}
                      onClick={() => setSelectedProviderType(providerMeta.type)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                        active
                          ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30'
                          : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900'
                      }`}
                    >
                      <span
                        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${getProviderTone()}`}
                      >
                        <Icon className='h-5 w-5' />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block text-sm font-semibold text-gray-900 dark:text-gray-100'>
                          {providerMeta.displayName}
                        </span>
                        <span className='mt-0.5 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                          {providerMeta.description}
                        </span>
                      </span>
                      <span className='text-xs font-medium text-gray-400'>
                        {creatable ? '可添加' : '内置'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className='mt-5 flex justify-end gap-2'>
                <button
                  type='button'
                  onClick={closeChannelModal}
                  className='rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                >
                  取消
                </button>
                <button
                  type='button'
                  onClick={openCreateForm}
                  disabled={saving || !selectedProviderType}
                  className='inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  下一步
                  <ChevronRight className='h-4 w-4' />
                </button>
              </div>
            </div>
          ) : form && provider ? (
            <div className='p-5'>
              <div className='mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/60'>
                <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  {provider.displayName}
                </div>
                <div className='mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400'>
                  {provider.description}
                </div>
              </div>

              <div className='grid gap-4'>
                <label className='flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200'>
                  渠道名称
                  <input
                    aria-label='渠道名称'
                    value={form.name}
                    disabled={saving}
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, name: event.target.value }
                          : current,
                      )
                    }
                    className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
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
                      className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                    />
                    {field.description && (
                      <span className='text-xs font-normal leading-5 text-gray-500 dark:text-gray-400'>
                        {field.description}
                      </span>
                    )}
                  </label>
                ))}
              </div>

              <div className='mt-5 flex justify-between gap-2'>
                {form.mode === 'create' ? (
                  <button
                    type='button'
                    onClick={() => {
                      setForm(null);
                      setChannelModalStep('provider');
                    }}
                    disabled={saving}
                    className='rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                  >
                    上一步
                  </button>
                ) : (
                  <span />
                )}
                <div className='flex gap-2'>
                  <button
                    type='button'
                    onClick={closeChannelModal}
                    disabled={saving}
                    className='rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                  >
                    取消
                  </button>
                  <button
                    type='button'
                    onClick={saveChannelForm}
                    disabled={saving || !isFormValid(form)}
                    className='inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                  >
                    {saving && (
                      <LoaderCircle className='h-4 w-4 animate-spin' />
                    )}
                    保存渠道
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  if (!authChecked || loading) {
    return (
      <main
        className={
          embedded
            ? 'p-4'
            : 'min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-950'
        }
      >
        <div className='mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'>
          <div className='flex items-center gap-2'>
            <LoaderCircle className='h-4 w-4 animate-spin' />
            正在加载通知设置
          </div>
        </div>
      </main>
    );
  }

  if (!canManageSettings) {
    return (
      <main
        className={
          embedded
            ? 'p-4'
            : 'min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-950'
        }
      >
        <div className='mx-auto max-w-5xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200'>
          通知设置仅管理员可见。请使用管理员账号登录后再管理通知渠道。
        </div>
      </main>
    );
  }

  return (
    <main
      className={
        embedded ? 'p-4' : 'min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-950'
      }
    >
      {renderModal()}
      <div className='mx-auto flex max-w-6xl flex-col gap-5'>
        {!embedded && (
          <div>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              通知设置
            </h1>
            <p className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
              管理通知总开关、Provider 渠道与事件订阅。布局已按 renewhelper
              的渠道管理交互重新组织。
            </p>
          </div>
        )}

        {message && (
          <div className='flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'>
            <CheckCircle2 className='h-4 w-4' />
            {message}
          </div>
        )}
        {error && (
          <div className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300'>
            {error}
          </div>
        )}

        {!settings ? null : (
          <>
            <section className='rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900'>
              <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
                <div className='flex items-start gap-3'>
                  <span className='inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'>
                    <BellRing className='h-5 w-5' />
                  </span>
                  <div>
                    <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                      通知配置
                    </h2>
                    <p className='mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400'>
                      推送总开关负责统一启停可用渠道；渠道新增、编辑与事件订阅统一在下方列表管理。
                    </p>
                  </div>
                </div>

                <div className='flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950 sm:min-w-80'>
                  <div className='flex items-center justify-between gap-4'>
                    <div>
                      <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                        推送总开关
                      </div>
                      <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                        {enabledChannelCount}/{settings.channels.length}{' '}
                        个渠道已启用
                      </div>
                    </div>
                    <button
                      type='button'
                      role='switch'
                      aria-checked={globalPushEnabled}
                      aria-label='推送总开关'
                      disabled={saving || settings.channels.length === 0}
                      onClick={toggleGlobalPush}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        globalPushEnabled
                          ? 'bg-blue-600'
                          : 'bg-gray-300 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          globalPushEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <div className='flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-gray-800'>
                    <button
                      type='button'
                      onClick={openAddChannel}
                      disabled={saving}
                      className='inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                    >
                      <MessageSquarePlus className='h-4 w-4' />
                      通知渠道管理入口
                    </button>
                    <button
                      type='button'
                      onClick={restoreDefault}
                      disabled={saving}
                      className='inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                    >
                      <RotateCcw className='h-4 w-4' />
                      恢复默认
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className='rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900'>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <div className='flex items-center gap-2'>
                    <Layers3 className='h-5 w-5 text-blue-600 dark:text-blue-300' />
                    <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                      通知渠道
                    </h2>
                  </div>
                  <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                    统一卡片列表展示所有通知方式，配置通过弹窗完成。
                  </p>
                </div>

                <div className='flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={openAddChannel}
                    disabled={saving}
                    className='inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                  >
                    <MessageSquarePlus className='h-4 w-4' />
                    添加渠道
                  </button>
                  <button
                    type='button'
                    onClick={toggleBatchMode}
                    disabled={saving || settings.channels.length === 0}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      batchMode
                        ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Check className='h-4 w-4' />
                    {batchMode ? '退出批量' : '批量选择'}
                  </button>
                </div>
              </div>

              {batchMode && (
                <div className='mt-4 flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20 sm:flex-row sm:items-center sm:justify-between'>
                  <div className='flex flex-wrap items-center gap-3 text-sm text-blue-800 dark:text-blue-200'>
                    <span className='font-semibold'>
                      已选择：{selectedChannelIds.length} 个渠道
                    </span>
                    <button
                      type='button'
                      onClick={toggleSelectAll}
                      className='text-xs font-medium text-blue-700 hover:underline dark:text-blue-300'
                    >
                      {allSelected ? '取消全选' : '全选'}
                    </button>
                    <button
                      type='button'
                      onClick={clearSelection}
                      disabled={selectedChannelIds.length === 0}
                      className='text-xs font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300'
                    >
                      取消选择
                    </button>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      type='button'
                      onClick={() => void batchPatchChannels(true)}
                      disabled={saving || selectedChannelIds.length === 0}
                      className='rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-900/60 dark:bg-gray-950 dark:text-emerald-300 dark:hover:bg-emerald-950/30'
                    >
                      批量启用
                    </button>
                    <button
                      type='button'
                      onClick={() => void batchPatchChannels(false)}
                      disabled={saving || selectedChannelIds.length === 0}
                      className='rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-900/60 dark:bg-gray-950 dark:text-amber-300 dark:hover:bg-amber-950/30'
                    >
                      批量禁用
                    </button>
                    <button
                      type='button'
                      onClick={() => void batchDeleteChannels()}
                      disabled={
                        saving || selectedDeletableChannels.length === 0
                      }
                      className='rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-gray-950 dark:text-red-300 dark:hover:bg-red-950/30'
                      title={
                        selectedDeletableChannels.length === 0
                          ? '所选渠道不可删除，内置 Inbox 不允许删除'
                          : undefined
                      }
                    >
                      批量删除
                    </button>
                  </div>
                </div>
              )}

              <div className='mt-4 grid gap-3'>
                {settings.channels.length === 0 ? (
                  <div className='rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400'>
                    暂无通知渠道，请点击右上角添加渠道。
                  </div>
                ) : (
                  settings.channels.map((channel) => {
                    const provider = getNotificationProviderMeta(channel.type);
                    const Icon = provider.icon;
                    const subscribedEvents = getCompatibleSubscribedEvents(
                      channel,
                      settings,
                    );
                    const testResult = testResults[channel.id];
                    const pending = channelSavingId === channel.id;
                    const selected = selectedChannelIds.includes(channel.id);

                    return (
                      <article
                        key={channel.id}
                        className={`group min-h-[154px] rounded-xl border bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-950 ${
                          selected
                            ? 'border-blue-400 ring-2 ring-blue-100 dark:border-blue-700 dark:ring-blue-950'
                            : 'border-gray-200 hover:border-blue-200 dark:border-gray-800 dark:hover:border-blue-900'
                        } ${!channel.enabled ? 'opacity-75' : ''}`}
                      >
                        <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                          <div className='flex min-w-0 flex-1 items-start gap-3'>
                            {batchMode && (
                              <input
                                aria-label={`选择 ${channel.name}`}
                                type='checkbox'
                                checked={selected}
                                onChange={() =>
                                  toggleChannelSelection(channel.id)
                                }
                                className='mt-3 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
                              />
                            )}
                            <span
                              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${getProviderTone()}`}
                            >
                              <Icon className='h-5 w-5' />
                            </span>
                            <div className='min-w-0 flex-1'>
                              <div className='flex flex-wrap items-center gap-2'>
                                <h3 className='truncate text-base font-semibold text-gray-900 dark:text-gray-100'>
                                  {channel.name}
                                </h3>
                                <span className='rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400'>
                                  {channel.type}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    channel.enabled
                                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                  }`}
                                >
                                  {channel.enabled ? '启用中' : '已停用'}
                                </span>
                              </div>
                              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                                {provider.displayName} · {provider.description}
                              </p>
                              <div className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                                最近测试：
                                {testResult ? (
                                  <span
                                    className={
                                      testResult.status === 'success'
                                        ? 'text-emerald-600 dark:text-emerald-300'
                                        : 'text-red-600 dark:text-red-300'
                                    }
                                  >
                                    {testResult.message} ·{' '}
                                    {formatTestTime(testResult.time)}
                                  </span>
                                ) : (
                                  <span>暂无测试记录</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className='flex flex-wrap items-center gap-2 lg:justify-end'>
                            {provider.capabilities.canToggle && (
                              <button
                                type='button'
                                role='switch'
                                aria-checked={channel.enabled}
                                aria-label={`启停 ${channel.name}`}
                                disabled={pending || saving}
                                onClick={() =>
                                  void updateChannel(channel, {
                                    enabled: !channel.enabled,
                                  })
                                }
                                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                  channel.enabled
                                    ? 'bg-blue-600'
                                    : 'bg-gray-300 dark:bg-gray-700'
                                }`}
                              >
                                <span
                                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                    channel.enabled
                                      ? 'translate-x-6'
                                      : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            )}
                            {provider.capabilities.canTest && (
                              <button
                                type='button'
                                disabled={pending || saving || !channel.enabled}
                                onClick={() => void sendTest(channel)}
                                className='inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
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
                                className='inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
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
                                className='inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30'
                              >
                                <Trash2 className='h-3.5 w-3.5' />
                                删除
                              </button>
                            )}
                          </div>
                        </div>

                        <div className='mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/60'>
                          <div className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                            事件
                          </div>
                          <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
                            {NOTIFICATION_EVENT_METAS.map((eventMeta) => {
                              const checked = subscribedEvents.includes(
                                eventMeta.type,
                              );
                              return (
                                <label
                                  key={eventMeta.type}
                                  className='flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-white dark:text-gray-200 dark:hover:bg-gray-950'
                                >
                                  <input
                                    type='checkbox'
                                    checked={checked}
                                    disabled={pending || saving}
                                    aria-label={`${channel.name} ${eventMeta.label}`}
                                    onChange={() => {
                                      const nextEvents =
                                        toggleEventSubscription(
                                          subscribedEvents,
                                          eventMeta.type,
                                        );
                                      void updateChannel(
                                        channel,
                                        { subscribedEvents: nextEvents },
                                        '事件订阅已更新',
                                      );
                                    }}
                                    className='mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60'
                                  />
                                  <span>
                                    <span className='block font-medium'>
                                      {eventMeta.label}
                                    </span>
                                    <span className='mt-0.5 hidden text-xs leading-5 text-gray-500 dark:text-gray-400 lg:block'>
                                      {eventMeta.description}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
