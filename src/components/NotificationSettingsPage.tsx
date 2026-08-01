'use client';

import {
  Check,
  ClipboardList,
  Layers3,
  LoaderCircle,
  MessageSquarePlus,
  PlayCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS,
  NOTIFICATION_EVENT_METAS,
  NOTIFICATION_TEST_EVENT_TYPE,
} from '@/lib/notification-event-bootstrap';

import { NotificationChannelList } from './notification/NotificationChannelList';
import { NotificationChannelModal } from './notification/NotificationChannelModal';
import { NotificationToggleSwitch } from './notification/NotificationToggleSwitch';
import type {
  ChannelFormState,
  ChannelModalStep,
  NotificationChannelConfig,
  NotificationSettings,
} from './notification/notification-settings-types';
import {
  type BackendNotificationProviderMeta,
  type NotificationProviderMeta,
  mergeNotificationProviderMeta,
} from './notification-settings-provider-ui';

interface SettingsResponse {
  settings: NotificationSettings;
}

interface ProvidersResponse {
  providers: BackendNotificationProviderMeta[];
}

interface NotificationLogItem {
  eventType: string;
  provider: string;
  channelId: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  time: number;
}

interface NotificationLogsResponse {
  logs: NotificationLogItem[];
}

interface RunNowResponse {
  eventType: string;
  success: boolean;
  totalChannels: number;
  succeeded: number;
  failed: number;
  errors: Array<{ channel: string; message: string }>;
}

const NOTIFICATION_SETTINGS_ENDPOINT = '/api/user/notification-settings';
const NOTIFICATION_CHANNELS_ENDPOINT = `${NOTIFICATION_SETTINGS_ENDPOINT}/channels`;
const NOTIFICATION_TEST_ENDPOINT = `${NOTIFICATION_SETTINGS_ENDPOINT}/test`;
const NOTIFICATION_RUN_NOW_ENDPOINT = `${NOTIFICATION_SETTINGS_ENDPOINT}/run-now`;
const NOTIFICATION_PROVIDERS_ENDPOINT = '/api/user/notification-providers';
const NOTIFICATION_LOGS_ENDPOINT = '/api/admin/notification-logs';
const ENTERPRISE_WECHAT_PROVIDER_TYPE = 'wechat_work';
const ENTERPRISE_WECHAT_MERGED_PROVIDER_TYPE = 'wecom';
const RUN_NOW_EVENT_METAS = NOTIFICATION_EVENT_METAS.filter(
  (eventMeta) => eventMeta.type === NOTIFICATION_TEST_EVENT_TYPE,
);

async function readSettingsResponse(
  response: Response,
): Promise<SettingsResponse> {
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

async function readProvidersResponse(
  response: Response,
): Promise<ProvidersResponse> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('请先登录后修改通知设置');
    if (response.status === 403) throw new Error('只有管理员可以修改通知设置');
    throw new Error(data.error || '通知渠道能力请求失败');
  }
  return data as ProvidersResponse;
}

async function readRunNowResponse(response: Response): Promise<RunNowResponse> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('请先登录后运行通知调试');
    if (response.status === 403) throw new Error('只有管理员可以运行通知调试');
    if (response.status === 400)
      throw new Error(data.error || '通知调试事件无效');
    throw new Error(data.error || '通知调试执行失败');
  }
  return data as RunNowResponse;
}

async function readNotificationLogsResponse(
  response: Response,
): Promise<NotificationLogsResponse> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403) throw new Error('只有管理员可以查看通知日志');
    throw new Error(data.error || '通知日志请求失败');
  }
  return data as NotificationLogsResponse;
}

function isAdminRole(role?: string) {
  return role === 'owner' || role === 'admin';
}

function getCompatibleSubscribedEvents(channel: NotificationChannelConfig) {
  if (Array.isArray(channel.subscribedEvents)) return channel.subscribedEvents;
  return [...DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS];
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
    name: provider.displayName,
    subscribedEvents: [...DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS],
    config: { ...provider.defaultConfig },
    originalConfig: {},
  };
}

function getCreatableNotificationProviders(
  providers: NotificationProviderMeta[],
) {
  const hasEnterpriseWechat = providers.some(
    (provider) =>
      provider.type === ENTERPRISE_WECHAT_PROVIDER_TYPE &&
      provider.capabilities.canCreate,
  );

  return providers.filter(
    (provider) =>
      provider.capabilities.canCreate &&
      !(
        hasEnterpriseWechat &&
        provider.type === ENTERPRISE_WECHAT_MERGED_PROVIDER_TYPE
      ),
  );
}

function buildEditForm(
  channel: NotificationChannelConfig,
  _settings: NotificationSettings,
  provider: NotificationProviderMeta,
): ChannelFormState {
  const config = normalizeConfigForForm(provider, channel.config);
  return {
    mode: 'edit',
    channelId: channel.id,
    providerType: channel.type,
    name: channel.name,
    subscribedEvents: getCompatibleSubscribedEvents(channel),
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

function hasConfigPatch(
  form: ChannelFormState,
  provider: NotificationProviderMeta,
) {
  return provider.configSchema.fields.some(
    (field) => form.config[field.key] !== form.originalConfig[field.key],
  );
}

function buildConfigPatch(
  form: ChannelFormState,
  provider: NotificationProviderMeta,
) {
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

function formatLogTime(value: number) {
  if (!Number.isFinite(value)) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function getLogStatusLabel(status: NotificationLogItem['status']) {
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  return '跳过';
}

function isFormValid(
  form: ChannelFormState,
  provider: NotificationProviderMeta | null,
) {
  if (!form.name.trim() || !provider) return false;
  return provider.configSchema.fields.every(
    (field) => !field.required || Boolean(form.config[field.key]?.trim()),
  );
}

export default function NotificationSettingsPage({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [providers, setProviders] = useState<NotificationProviderMeta[]>([]);
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
  const [runNowOpen, setRunNowOpen] = useState(false);
  const [runNowSaving, setRunNowSaving] = useState(false);
  const [runNowEventType, setRunNowEventType] = useState<string>(
    DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS[0],
  );
  const [runNowResult, setRunNowResult] = useState<RunNowResponse | null>(null);
  const [runNowError, setRunNowError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [notificationLogs, setNotificationLogs] = useState<
    NotificationLogItem[]
  >([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [canManageSettings, setCanManageSettings] = useState(false);

  const providerByType = useMemo(
    () => new Map(providers.map((provider) => [provider.type, provider])),
    [providers],
  );
  const creatableProviders = useMemo(
    () => getCreatableNotificationProviders(providers),
    [providers],
  );
  const selectedChannels = useMemo(
    () =>
      settings?.channels.filter((channel) =>
        selectedChannelIds.includes(channel.id),
      ) ?? [],
    [selectedChannelIds, settings],
  );
  const selectedDeletableChannels = useMemo(
    () =>
      selectedChannels.filter(
        (channel) => providerByType.get(channel.type)?.capabilities.canDelete,
      ),
    [providerByType, selectedChannels],
  );
  const globalPushEnabled = settings?.notificationCenterEnabled ?? false;
  const allSelected =
    settings !== null &&
    settings.channels.length > 0 &&
    selectedChannelIds.length === settings.channels.length;
  const formProvider = form
    ? (providerByType.get(form.providerType) ?? null)
    : null;

  useEffect(() => {
    const auth = getAuthInfoFromBrowserCookie();
    setCanManageSettings(isAdminRole(auth?.role));
    setAuthChecked(true);
  }, []);

  const closeChannelModal = useCallback(() => {
    setChannelModalStep(null);
    setForm(null);
  }, []);

  const closeRunNowModal = useCallback(() => {
    if (runNowSaving) return;
    setRunNowOpen(false);
    setRunNowResult(null);
    setRunNowError(null);
  }, [runNowSaving]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResponse, providersResponse] = await Promise.all([
        fetch(NOTIFICATION_SETTINGS_ENDPOINT, { cache: 'no-store' }),
        fetch(NOTIFICATION_PROVIDERS_ENDPOINT, { cache: 'no-store' }),
      ]);
      const [settingsData, providersData] = await Promise.all([
        readSettingsResponse(settingsResponse),
        readProvidersResponse(providersResponse),
      ]);
      setSettings(settingsData.settings);
      setProviders(providersData.providers.map(mergeNotificationProviderMeta));
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
    return (await readSettingsResponse(response)).settings;
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
      applySettings(await patchChannel(channel, patch));
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
      applySettings((await readSettingsResponse(response)).settings);
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
    if (!form || !formProvider || !isFormValid(form, formProvider)) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const configPatch = buildConfigPatch(form, formProvider);
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        subscribedEvents: form.subscribedEvents,
      };
      if (form.mode === 'create') {
        body.type = form.providerType;
        body.config = configPatch;
      } else if (hasConfigPatch(form, formProvider)) {
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
      applySettings((await readSettingsResponse(response)).settings);
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
    const provider = providerByType.get(channel.type);
    if (!provider?.capabilities.canDelete) return;

    setChannelSavingId(channel.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${NOTIFICATION_CHANNELS_ENDPOINT}/${channel.id}`,
        { method: 'DELETE' },
      );
      applySettings((await readSettingsResponse(response)).settings);
      setMessage('通知渠道已删除');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知渠道删除失败');
    } finally {
      setChannelSavingId(null);
    }
  };

  const sendTest = async (channel: NotificationChannelConfig) => {
    const provider = providerByType.get(channel.type);
    if (!provider?.capabilities.canTest) return;

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
      setMessage(
        provider.capabilities.canSend
          ? '测试通知已发送'
          : '配置校验通过，发送能力待实现',
      );
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

  const openRunNow = () => {
    setRunNowEventType(NOTIFICATION_TEST_EVENT_TYPE);
    setRunNowResult(null);
    setRunNowError(null);
    setRunNowOpen(true);
    setMessage(null);
    setError(null);
  };

  const runNow = async () => {
    setRunNowSaving(true);
    setRunNowResult(null);
    setRunNowError(null);
    try {
      const response = await fetch(NOTIFICATION_RUN_NOW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: runNowEventType }),
      });
      setRunNowResult(await readRunNowResponse(response));
    } catch (reason) {
      setRunNowError(
        reason instanceof Error ? reason.message : '通知调试执行失败',
      );
    } finally {
      setRunNowSaving(false);
    }
  };

  const loadNotificationLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const response = await fetch(`${NOTIFICATION_LOGS_ENDPOINT}?limit=100`, {
        cache: 'no-store',
      });
      const data = await readNotificationLogsResponse(response);
      setNotificationLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (reason) {
      setNotificationLogs([]);
      setLogsError(
        reason instanceof Error ? reason.message : '通知日志请求失败',
      );
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const toggleNotificationLogs = () => {
    const nextOpen = !logsOpen;
    setLogsOpen(nextOpen);
    if (nextOpen) void loadNotificationLogs();
  };

  const openCreateForm = (providerType: string) => {
    const provider = providerByType.get(providerType);
    if (!provider?.capabilities.canCreate) return;
    setForm(buildCreateForm(provider));
    setChannelModalStep('config');
  };

  const openEditForm = (channel: NotificationChannelConfig) => {
    if (!settings) return;
    const provider = providerByType.get(channel.type);
    if (!provider?.capabilities.canEdit) return;
    setForm(buildEditForm(channel, settings, provider));
    setChannelModalStep('config');
    setMessage(null);
    setError(null);
  };

  const toggleGlobalPush = async () => {
    if (!settings || saving) return;
    const nextEnabled = !globalPushEnabled;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(NOTIFICATION_SETTINGS_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationCenterEnabled: nextEnabled }),
      });
      applySettings((await readSettingsResponse(response)).settings);
      if (!nextEnabled) {
        setBatchMode(false);
        setSelectedChannelIds([]);
      }
      setMessage(nextEnabled ? '通知中心已启用' : '通知中心已关闭');
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

  const runBatchPatch = async (enabled: boolean) => {
    const togglableSelectedChannels = selectedChannels.filter(
      (channel) => providerByType.get(channel.type)?.capabilities.canToggle,
    );
    if (togglableSelectedChannels.length === 0) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      let nextSettings = settings;
      for (const channel of togglableSelectedChannels) {
        if (!nextSettings) break;
        nextSettings = await patchChannel(channel, { enabled });
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
        nextSettings = (await readSettingsResponse(response)).settings;
      }
      if (nextSettings) applySettings(nextSettings);
      setMessage('批量删除已完成');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量删除失败');
    } finally {
      setSaving(false);
    }
  };

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
      ) : settings ? (
        <>
          <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950/80'>
            <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
              <div>
                <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  推送总开关
                </h2>
                <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                  控制是否启用通知推送
                </p>
              </div>
              <NotificationToggleSwitch
                checked={globalPushEnabled}
                disabled={saving}
                label='推送总开关'
                onClick={() => void toggleGlobalPush()}
              />
            </div>
            {globalPushEnabled && (
              <div className='mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-800'>
                <button
                  type='button'
                  disabled={saving}
                  onClick={openAddChannel}
                  className='inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'
                >
                  <MessageSquarePlus className='h-4 w-4' />
                  添加通知渠道
                </button>
                <button
                  type='button'
                  disabled={saving}
                  onClick={openRunNow}
                  className='inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                >
                  <PlayCircle className='h-4 w-4' />
                  立即测试通知
                </button>
                <button
                  type='button'
                  disabled={saving || settings.channels.length === 0}
                  onClick={toggleBatchMode}
                  className='inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                >
                  <Layers3 className='h-4 w-4' />
                  批量管理
                </button>
                <button
                  type='button'
                  disabled={saving}
                  onClick={toggleNotificationLogs}
                  className='inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                >
                  <ClipboardList className='h-4 w-4' />
                  通知日志
                </button>
                <button
                  type='button'
                  disabled={saving}
                  onClick={() => void restoreDefault()}
                  className='inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                >
                  <RotateCcw className='h-4 w-4' />
                  恢复默认
                </button>
              </div>
            )}
          </section>

          {globalPushEnabled && (
            <NotificationChannelList
              channels={settings.channels}
              updatedAtLabel={null}
              providerByType={providerByType}
              batchMode={batchMode}
              selectedChannelIds={selectedChannelIds}
              saving={saving}
              channelSavingId={channelSavingId}
              allSelected={allSelected}
              selectedDeletableCount={selectedDeletableChannels.length}
              onSelectAll={toggleSelectAll}
              onBatchEnable={() => void runBatchPatch(true)}
              onBatchDisable={() => void runBatchPatch(false)}
              onBatchDelete={() => void runBatchDelete()}
              onExitBatch={toggleBatchMode}
              onSelectChannel={toggleChannelSelection}
              onToggleChannel={(channel) =>
                void updateChannel(
                  channel,
                  { enabled: !channel.enabled },
                  channel.enabled ? '通知渠道已关闭' : '通知渠道已启用',
                )
              }
              onTestChannel={(channel) => void sendTest(channel)}
              onEditChannel={openEditForm}
              onDeleteChannel={(channel) => void deleteChannel(channel)}
            />
          )}

          {logsOpen && (
            <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950/80'>
              <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                <div>
                  <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                    通知日志
                  </h2>
                  <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                    显示最近 100 条通知发送记录。
                  </p>
                </div>
                <button
                  type='button'
                  disabled={logsLoading}
                  onClick={() => void loadNotificationLogs()}
                  className='inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                >
                  {logsLoading ? (
                    <LoaderCircle className='h-4 w-4 animate-spin' />
                  ) : (
                    <RotateCcw className='h-4 w-4' />
                  )}
                  刷新
                </button>
              </div>

              {logsError && (
                <div className='mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'>
                  {logsError}
                </div>
              )}

              {logsLoading ? (
                <div className='flex items-center gap-2 py-8 text-sm text-gray-500 dark:text-gray-400'>
                  <LoaderCircle className='h-4 w-4 animate-spin' />
                  正在加载通知日志
                </div>
              ) : notificationLogs.length === 0 ? (
                <div className='rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
                  暂无通知日志。
                </div>
              ) : (
                <div className='max-h-[420px] overflow-auto rounded-xl border border-gray-200 dark:border-gray-800'>
                  <table className='min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800'>
                    <thead className='sticky top-0 bg-gray-50 dark:bg-gray-900'>
                      <tr>
                        {['时间', '事件', '渠道', '状态', '错误原因'].map(
                          (label) => (
                            <th
                              key={label}
                              className='whitespace-nowrap px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400'
                            >
                              {label}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950'>
                      {notificationLogs.map((log) => (
                        <tr
                          key={`${log.time}-${log.channelId}-${log.eventType}`}
                        >
                          <td className='whitespace-nowrap px-3 py-3 text-gray-900 dark:text-gray-100'>
                            {formatLogTime(log.time)}
                          </td>
                          <td className='whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300'>
                            {log.eventType}
                          </td>
                          <td className='whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300'>
                            {log.provider}
                          </td>
                          <td
                            className={`whitespace-nowrap px-3 py-3 font-medium ${
                              log.status === 'success'
                                ? 'text-green-700 dark:text-green-300'
                                : log.status === 'failed'
                                  ? 'text-red-700 dark:text-red-300'
                                  : 'text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {getLogStatusLabel(log.status)}
                          </td>
                          <td className='max-w-md px-3 py-3 text-gray-700 dark:text-gray-300'>
                            {log.error || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      ) : null}

      <NotificationChannelModal
        step={channelModalStep}
        form={form}
        provider={formProvider}
        creatableProviders={creatableProviders}
        saving={saving}
        valid={form ? isFormValid(form, formProvider) : false}
        onClose={closeChannelModal}
        onPickProvider={openCreateForm}
        onBackToPicker={() => {
          setForm(null);
          setChannelModalStep('provider');
        }}
        onChangeForm={setForm}
        onToggleEvent={(eventType) =>
          setForm((current) =>
            current
              ? {
                  ...current,
                  subscribedEvents: toggleEventSubscription(
                    current.subscribedEvents,
                    eventType,
                  ),
                }
              : current,
          )
        }
        onSave={() => void saveChannelForm()}
      />

      {runNowOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm'>
          <div className='w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950'>
            <div className='flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800'>
              <div>
                <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                  立即测试通知
                </h3>
                <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                  生成调试事件并走完整通知链路。
                </p>
              </div>
              <button
                type='button'
                aria-label='关闭立即测试通知'
                disabled={runNowSaving}
                onClick={closeRunNowModal}
                className='rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100'
              >
                <X className='h-5 w-5' />
              </button>
            </div>
            <div className='space-y-4 p-5'>
              <label className='block space-y-2'>
                <span className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                  测试事件
                </span>
                <select
                  value={runNowEventType}
                  disabled={runNowSaving}
                  onChange={(event) => setRunNowEventType(event.target.value)}
                  className='w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                >
                  {RUN_NOW_EVENT_METAS.map((eventMeta) => (
                    <option key={eventMeta.type} value={eventMeta.type}>
                      {eventMeta.label}
                    </option>
                  ))}
                </select>
              </label>

              {runNowResult && (
                <div
                  role='status'
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    runNowResult.success
                      ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-200'
                      : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'
                  }`}
                >
                  <div className='font-semibold'>
                    {runNowResult.success ? '✓ 已发送' : '✗ 错误原因'}
                  </div>
                  <div className='mt-2 space-y-1 text-xs'>
                    <div>事件类型：{runNowResult.eventType}</div>
                    <div>匹配渠道数量：{runNowResult.totalChannels}</div>
                    <div>成功数量：{runNowResult.succeeded}</div>
                    <div>失败数量：{runNowResult.failed}</div>
                    {!runNowResult.success &&
                      runNowResult.errors.map((item) => (
                        <div key={`${item.channel}-${item.message}`}>
                          {item.channel}: {item.message}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {runNowError && (
                <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'>
                  {runNowError}
                </div>
              )}

              <div className='flex justify-end gap-2'>
                <button
                  type='button'
                  disabled={runNowSaving}
                  onClick={closeRunNowModal}
                  className='rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                >
                  取消
                </button>
                <button
                  type='button'
                  disabled={runNowSaving}
                  onClick={() => void runNow()}
                  className='inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'
                >
                  {runNowSaving && (
                    <LoaderCircle className='h-4 w-4 animate-spin' />
                  )}
                  执行测试
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <main className='min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-950 sm:px-6 lg:px-8'>
      <div className='mx-auto max-w-5xl'>{content}</div>
    </main>
  );
}
