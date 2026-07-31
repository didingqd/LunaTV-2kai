'use client';

import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { NotificationMessageType } from '@/lib/notification/notification-types';
import type {
  InboxNotification,
  NotificationMessageType as NotificationMessageTypeValue,
} from '@/lib/notification/notification-types';

interface NotificationListResponse {
  notifications: InboxNotification[];
  total: number;
  unread: number;
}

const NOTIFICATIONS_ENDPOINT = '/api/user/notifications';

const TYPE_META: Record<
  NotificationMessageTypeValue,
  {
    label: string;
    tone: string;
    icon: typeof Bell;
  }
> = {
  [NotificationMessageType.WATCHING_UPDATE_FOUND]: {
    label: '追更更新',
    tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  [NotificationMessageType.WATCHING_UPDATE_FAILED]: {
    label: '检查失败',
    tone: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    icon: AlertCircle,
  },
  [NotificationMessageType.SYSTEM]: {
    label: '系统通知',
    tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    icon: Bell,
  },
  [NotificationMessageType.MANUAL_TRIGGER]: {
    label: '手动触发',
    tone: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    icon: RefreshCw,
  },
  [NotificationMessageType.DOWNLOAD]: {
    label: '下载通知',
    tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    icon: Inbox,
  },
};

function getTypeMeta(type: NotificationMessageTypeValue) {
  return TYPE_META[type] ?? TYPE_META[NotificationMessageType.SYSTEM];
}

async function readNotificationResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('请先登录后查看通知');
    if (response.status === 404) throw new Error('通知不存在');
    if (response.status === 400) throw new Error(data.error || '通知请求格式无效');
    throw new Error(data.error || '通知请求失败');
  }
  return data;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export default function NotificationCenterPage() {
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedNotification = useMemo(
    () =>
      notifications.find((notification) => notification.id === selectedId) ??
      notifications[0] ??
      null,
    [notifications, selectedId],
  );

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(NOTIFICATIONS_ENDPOINT, {
        cache: 'no-store',
      });
      const data = (await readNotificationResponse(
        response,
      )) as NotificationListResponse;
      setNotifications(data.notifications);
      setTotal(data.total);
      setUnread(data.unread);
      setSelectedId((current) =>
        current && data.notifications.some((item) => item.id === current)
          ? current
          : (data.notifications[0]?.id ?? null),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const updateLocalNotification = (next: InboxNotification) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === next.id ? next : notification,
      ),
    );
    setUnread((current) =>
      next.read ? Math.max(0, current - 1) : current + 1,
    );
  };

  const markRead = async (notification: InboxNotification, read: boolean) => {
    setSavingId(notification.id);
    setError(null);
    try {
      const response = await fetch(`${NOTIFICATIONS_ENDPOINT}/${notification.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read }),
      });
      const next = (await readNotificationResponse(response)) as InboxNotification;
      updateLocalNotification(next);
      setSelectedId(next.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知状态更新失败');
    } finally {
      setSavingId(null);
    }
  };

  const selectNotification = async (notification: InboxNotification) => {
    setSelectedId(notification.id);
    if (!notification.read) {
      await markRead(notification, true);
    }
  };

  const deleteNotification = async (notification: InboxNotification) => {
    setSavingId(notification.id);
    setError(null);
    try {
      const response = await fetch(`${NOTIFICATIONS_ENDPOINT}/${notification.id}`, {
        method: 'DELETE',
      });
      await readNotificationResponse(response);
      const wasRead = notification.read;
      setNotifications((current) => {
        const next = current.filter((item) => item.id !== notification.id);
        setSelectedId(next[0]?.id ?? null);
        return next;
      });
      setTotal((current) => Math.max(0, current - 1));
      if (!wasRead) setUnread((current) => Math.max(0, current - 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知删除失败');
    } finally {
      setSavingId(null);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    setError(null);
    try {
      const response = await fetch(NOTIFICATIONS_ENDPOINT, {
        method: 'DELETE',
      });
      await readNotificationResponse(response);
      setNotifications([]);
      setSelectedId(null);
      setTotal(0);
      setUnread(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清空通知失败');
    } finally {
      setClearing(false);
    }
  };

  return (
    <main className='min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100'>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8'>
        <header className='flex flex-col gap-3 border-b border-gray-200 pb-5 dark:border-gray-800 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <h1 className='text-2xl font-semibold'>通知中心</h1>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              共 {total} 条通知，{unread} 条未读
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => void loadNotifications()}
              disabled={loading}
              className='inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              <RefreshCw className='h-4 w-4' />
              刷新
            </button>
            <button
              type='button'
              onClick={() => void clearAll()}
              disabled={clearing || notifications.length === 0}
              className='inline-flex items-center gap-2 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40'
            >
              <Trash2 className='h-4 w-4' />
              清空全部
            </button>
          </div>
        </header>

        {error && (
          <div className='flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'>
            <AlertCircle className='h-4 w-4 shrink-0' />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className='flex min-h-72 items-center justify-center rounded-md border border-dashed border-gray-300 bg-white dark:border-gray-800 dark:bg-gray-900'>
            <LoaderCircle className='h-6 w-6 animate-spin text-gray-500' />
            <span className='ml-2 text-sm text-gray-500'>正在加载通知</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className='flex min-h-72 flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-white text-center dark:border-gray-800 dark:bg-gray-900'>
            <Inbox className='h-10 w-10 text-gray-400' />
            <p className='mt-3 text-base font-medium'>暂无通知</p>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              有新的追更提醒或系统消息时会显示在这里
            </p>
          </div>
        ) : (
          <section className='grid min-h-[520px] gap-4 lg:grid-cols-[minmax(0,380px)_1fr]'>
            <div className='overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'>
              <div className='border-b border-gray-200 px-4 py-3 text-sm font-medium dark:border-gray-800'>
                通知列表
              </div>
              <div className='max-h-[620px] overflow-y-auto'>
                {notifications.map((notification) => (
                  <NotificationListItem
                    key={notification.id}
                    notification={notification}
                    selected={selectedNotification?.id === notification.id}
                    saving={savingId === notification.id}
                    onSelect={() => void selectNotification(notification)}
                  />
                ))}
              </div>
            </div>

            <NotificationDetail
              notification={selectedNotification}
              saving={savingId === selectedNotification?.id}
              onMarkRead={(read) => {
                if (selectedNotification) void markRead(selectedNotification, read);
              }}
              onDelete={() => {
                if (selectedNotification) void deleteNotification(selectedNotification);
              }}
            />
          </section>
        )}
      </div>
    </main>
  );
}

function NotificationListItem({
  notification,
  selected,
  saving,
  onSelect,
}: {
  notification: InboxNotification;
  selected: boolean;
  saving: boolean;
  onSelect: () => void;
}) {
  const meta = getTypeMeta(notification.type);
  const Icon = meta.icon;

  return (
    <button
      type='button'
      onClick={onSelect}
      className={`flex w-full gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-gray-800 ${
        selected
          ? 'bg-gray-100 dark:bg-gray-800'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
      }`}
    >
      <span
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${meta.tone}`}
      >
        <Icon className='h-4 w-4' />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-2'>
          {!notification.read && (
            <span
              aria-label='未读'
              className='h-2 w-2 shrink-0 rounded-full bg-red-500'
            />
          )}
          <span
            className={`truncate text-sm ${
              notification.read ? 'font-medium' : 'font-semibold'
            }`}
          >
            {notification.title}
          </span>
          {saving && <LoaderCircle className='h-3.5 w-3.5 animate-spin' />}
        </span>
        <span className='mt-1 line-clamp-2 block text-xs text-gray-500 dark:text-gray-400'>
          {notification.content}
        </span>
        <span className='mt-2 block text-xs text-gray-400'>
          {formatTime(notification.createdAt)}
        </span>
      </span>
    </button>
  );
}

function NotificationDetail({
  notification,
  saving,
  onMarkRead,
  onDelete,
}: {
  notification: InboxNotification | null;
  saving: boolean;
  onMarkRead: (read: boolean) => void;
  onDelete: () => void;
}) {
  if (!notification) {
    return (
      <div className='rounded-md border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900'>
        <p className='text-sm text-gray-500'>请选择一条通知查看详情</p>
      </div>
    );
  }

  const meta = getTypeMeta(notification.type);
  const Icon = meta.icon;

  return (
    <article className='rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'>
      <div className='border-b border-gray-200 px-5 py-4 dark:border-gray-800'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex min-w-0 gap-3'>
            <span
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${meta.tone}`}
            >
              <Icon className='h-5 w-5' />
            </span>
            <div className='min-w-0'>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='text-lg font-semibold'>{notification.title}</h2>
                <span className={`rounded px-2 py-0.5 text-xs ${meta.tone}`}>
                  {meta.label}
                </span>
                <span className='rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300'>
                  {notification.read ? '已读' : '未读'}
                </span>
              </div>
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                创建时间：{formatTime(notification.createdAt)}
              </p>
              {notification.readAt !== null && (
                <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                  已读时间：{formatTime(notification.readAt)}
                </p>
              )}
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <button
              type='button'
              onClick={() => onMarkRead(!notification.read)}
              disabled={saving}
              className='inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              {notification.read ? (
                <XCircle className='h-4 w-4' />
              ) : (
                <Check className='h-4 w-4' />
              )}
              {notification.read ? '标记未读' : '标记已读'}
            </button>
            <button
              type='button'
              onClick={onDelete}
              disabled={saving}
              className='inline-flex items-center gap-2 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40'
            >
              <Trash2 className='h-4 w-4' />
              删除
            </button>
          </div>
        </div>
      </div>
      <div className='space-y-5 px-5 py-5'>
        <p className='whitespace-pre-wrap text-sm leading-6 text-gray-800 dark:text-gray-200'>
          {notification.content}
        </p>
        {notification.payload && Object.keys(notification.payload).length > 0 && (
          <div className='rounded-md bg-gray-50 p-3 dark:bg-gray-950'>
            <p className='mb-2 text-xs font-medium uppercase tracking-wide text-gray-500'>
              Payload
            </p>
            <pre className='overflow-auto text-xs text-gray-600 dark:text-gray-300'>
              {JSON.stringify(notification.payload, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </article>
  );
}
