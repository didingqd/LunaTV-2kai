'use client';

import {
  Bell,
  Check,
  LoaderCircle,
  MessageSquarePlus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface NotificationChannelConfig {
  id: string;
  type: 'inbox' | 'wechat_work';
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface NotificationSettings {
  inboxEnabled: boolean;
  watchingUpdateFoundEnabled: boolean;
  watchingUpdateFailedEnabled: boolean;
  channels: NotificationChannelConfig[];
  updatedAt?: number;
}

interface SettingsResponse {
  settings: NotificationSettings;
}

const NOTIFICATION_SETTINGS_ENDPOINT = '/api/user/notification-settings';
const NOTIFICATION_CHANNELS_ENDPOINT = `${NOTIFICATION_SETTINGS_ENDPOINT}/channels`;
const NOTIFICATION_TEST_ENDPOINT = `${NOTIFICATION_SETTINGS_ENDPOINT}/test`;

async function readSettingsResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('请先登录后修改通知设置');
    if (response.status === 400) throw new Error(data.error || '通知设置格式无效');
    throw new Error(data.error || '通知设置请求失败');
  }
  return data as SettingsResponse;
}

function SettingToggle({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className='flex items-start gap-3 rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900'>
      <input
        type='checkbox'
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className='mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed dark:border-gray-700 dark:bg-gray-950'
      />
      <span className='min-w-0'>
        <span className='block text-sm font-medium text-gray-900 dark:text-gray-100'>
          {label}
        </span>
        <span className='mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
          {description}
        </span>
      </span>
    </label>
  );
}

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [addingWeChatWork, setAddingWeChatWork] = useState(false);
  const [newChannelName, setNewChannelName] = useState('企业微信');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [editingWebhookById, setEditingWebhookById] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channelSavingId, setChannelSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(NOTIFICATION_SETTINGS_ENDPOINT, {
        cache: 'no-store',
      });
      const data = await readSettingsResponse(response);
      setSettings(data.settings);
      setDraft(data.settings);
      setEditingWebhookById({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知设置请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateDraft = (field: keyof NotificationSettings, value: boolean) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setMessage(null);
  };

  const applySettings = (next: NotificationSettings) => {
    setSettings(next);
    setDraft(next);
    setEditingWebhookById({});
  };

  const saveSettings = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(NOTIFICATION_SETTINGS_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inboxEnabled: draft.inboxEnabled,
          watchingUpdateFoundEnabled: draft.watchingUpdateFoundEnabled,
          watchingUpdateFailedEnabled: draft.watchingUpdateFailedEnabled,
        }),
      });
      const data = await readSettingsResponse(response);
      applySettings(data.settings);
      setMessage('通知设置已保存');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知设置保存失败');
    } finally {
      setSaving(false);
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
      setMessage('已恢复默认通知设置');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复默认失败');
    } finally {
      setSaving(false);
    }
  };

  const createWeChatWorkChannel = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(NOTIFICATION_CHANNELS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'wechat_work',
          name: newChannelName,
          config: {
            webhookUrl: newWebhookUrl,
          },
        }),
      });
      const data = await readSettingsResponse(response);
      applySettings(data.settings);
      setAddingWeChatWork(false);
      setNewChannelName('企业微信');
      setNewWebhookUrl('');
      setMessage('通知方式已添加');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知方式添加失败');
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
      const response = await fetch(`${NOTIFICATION_CHANNELS_ENDPOINT}/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
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
      const response = await fetch(`${NOTIFICATION_CHANNELS_ENDPOINT}/${channel.id}`, {
        method: 'DELETE',
      });
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
      setMessage('测试通知已发送');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '测试通知发送失败');
    } finally {
      setChannelSavingId(null);
    }
  };

  const hasChanges =
    Boolean(settings && draft) &&
    (settings?.inboxEnabled !== draft?.inboxEnabled ||
      settings?.watchingUpdateFoundEnabled !==
        draft?.watchingUpdateFoundEnabled ||
      settings?.watchingUpdateFailedEnabled !==
        draft?.watchingUpdateFailedEnabled);

  const getChannelTypeLabel = (type: NotificationChannelConfig['type']) =>
    type === 'wechat_work' ? '企业微信' : '站内通知';

  return (
    <main className='min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100'>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8'>
        <header className='border-b border-gray-200 pb-5 dark:border-gray-800'>
          <div className='flex items-center gap-3'>
            <span className='inline-flex h-10 w-10 items-center justify-center rounded-md bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'>
              <Bell className='h-5 w-5' />
            </span>
            <div>
              <h1 className='text-2xl font-semibold tracking-normal'>通知设置</h1>
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                管理站内通知和追更通知接收偏好
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

        {draft && (
          <>
            <section className='space-y-3'>
              <div>
                <div className='flex items-center justify-between gap-3'>
                  <div>
                    <h2 className='text-base font-semibold'>通知方式</h2>
                    <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                      管理站内通知和企业微信等通知渠道
                    </p>
                  </div>
                  <button
                    type='button'
                    onClick={() => setAddingWeChatWork(true)}
                    disabled={saving || addingWeChatWork}
                    className='inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                  >
                    <MessageSquarePlus className='h-4 w-4' />
                    添加通知方式
                  </button>
                </div>
              </div>

              {draft.channels.map((channel) => {
                const pending = channelSavingId === channel.id;
                const editableWebhook =
                  editingWebhookById[channel.id] ??
                  (typeof channel.config.webhookUrl === 'string'
                    ? channel.config.webhookUrl
                    : '');
                return (
                  <div
                    key={channel.id}
                    className='rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900'
                  >
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                      <div className='min-w-0'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                            {channel.name}
                          </span>
                          <span className='rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300'>
                            {getChannelTypeLabel(channel.type)}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs ${
                              channel.enabled
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                            }`}
                          >
                            {channel.enabled ? '已启用' : '已禁用'}
                          </span>
                        </div>
                        {channel.type === 'wechat_work' && (
                          <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                            Webhook：
                            {typeof channel.config.webhookUrl === 'string'
                              ? channel.config.webhookUrl
                              : '未配置'}
                          </p>
                        )}
                      </div>
                      <div className='flex flex-wrap gap-2'>
                        <button
                          type='button'
                          disabled={pending || saving}
                          onClick={() =>
                            updateChannel(channel, {
                              enabled: !channel.enabled,
                            })
                          }
                          className='rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                        >
                          {channel.enabled ? '禁用' : '启用'}
                        </button>
                        {channel.type === 'wechat_work' && (
                          <button
                            type='button'
                            disabled={pending || saving || !channel.enabled}
                            onClick={() => sendTest(channel)}
                            className='rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                          >
                            测试发送
                          </button>
                        )}
                        {channel.type !== 'inbox' && (
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

                    {channel.type === 'wechat_work' && (
                      <div className='mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]'>
                        <input
                          aria-label={`${channel.name}名称`}
                          value={channel.name}
                          disabled={pending || saving}
                          onChange={(event) =>
                            updateChannel(channel, { name: event.target.value })
                          }
                          className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                        />
                        <input
                          aria-label={`${channel.name}Webhook URL`}
                          value={editableWebhook}
                          disabled={pending || saving}
                          onChange={(event) =>
                            setEditingWebhookById((current) => ({
                              ...current,
                              [channel.id]: event.target.value,
                            }))
                          }
                          placeholder='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
                          className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                        />
                        <button
                          type='button'
                          disabled={pending || saving}
                          onClick={() =>
                            updateChannel(channel, {
                              config: { webhookUrl: editableWebhook },
                            })
                          }
                          className='rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                        >
                          保存渠道
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {addingWeChatWork && (
                <div className='rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20'>
                  <h3 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                    添加企业微信
                  </h3>
                  <div className='mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
                    <input
                      aria-label='通知方式名称'
                      value={newChannelName}
                      disabled={saving}
                      onChange={(event) => setNewChannelName(event.target.value)}
                      className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                    />
                    <input
                      aria-label='企业微信 Webhook URL'
                      value={newWebhookUrl}
                      disabled={saving}
                      onChange={(event) => setNewWebhookUrl(event.target.value)}
                      placeholder='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'
                      className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                    />
                  </div>
                  <div className='mt-3 flex justify-end gap-2'>
                    <button
                      type='button'
                      disabled={saving}
                      onClick={() => setAddingWeChatWork(false)}
                      className='rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
                    >
                      取消
                    </button>
                    <button
                      type='button'
                      disabled={saving || !newWebhookUrl.trim()}
                      onClick={createWeChatWorkChannel}
                      className='rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                    >
                      创建
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className='space-y-3'>
              <div>
                <h2 className='text-base font-semibold'>追更通知</h2>
                <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                  控制追更检查结果是否生成通知
                </p>
              </div>
              <SettingToggle
                label='发现更新'
                description='追更检查发现新剧集时通知我。'
                checked={draft.watchingUpdateFoundEnabled}
                disabled={saving}
                onChange={(checked) =>
                  updateDraft('watchingUpdateFoundEnabled', checked)
                }
              />
              <SettingToggle
                label='检查失败'
                description='追更检查遇到资源站异常或解析失败时通知我。'
                checked={draft.watchingUpdateFailedEnabled}
                disabled={saving}
                onChange={(checked) =>
                  updateDraft('watchingUpdateFailedEnabled', checked)
                }
              />
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
              <button
                type='button'
                onClick={saveSettings}
                disabled={saving || !hasChanges}
                className='inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
              >
                {saving ? (
                  <LoaderCircle className='h-4 w-4 animate-spin' />
                ) : (
                  <Save className='h-4 w-4' />
                )}
                保存
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
