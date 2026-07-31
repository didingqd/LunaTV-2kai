import { Edit3, LoaderCircle, Send, Trash2 } from 'lucide-react';

import {
  NOTIFICATION_DELIVERY_STATUS_LABELS,
  type NotificationProviderMeta,
} from '../notification-settings-provider-ui';
import { NotificationToggleSwitch } from './NotificationToggleSwitch';
import type { NotificationChannelConfig } from './notification-settings-types';

interface NotificationChannelItemProps {
  channel: NotificationChannelConfig;
  provider: NotificationProviderMeta;
  batchMode: boolean;
  selected: boolean;
  saving: boolean;
  pending: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function NotificationChannelItem({
  channel,
  provider,
  batchMode,
  selected,
  saving,
  pending,
  onSelect,
  onToggle,
  onTest,
  onEdit,
  onDelete,
}: NotificationChannelItemProps) {
  const Icon = provider.icon;
  const testLabel = provider.capabilities.canSend ? '测试' : '校验配置';

  return (
    <article
      className={`flex min-h-24 items-center gap-3 rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm dark:bg-gray-950 ${
        selected
          ? 'border-blue-300 ring-2 ring-blue-500/20 dark:border-blue-700'
          : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      {batchMode && (
        <input
          type='checkbox'
          checked={selected}
          aria-label={`选择 ${channel.name}`}
          disabled={saving}
          onChange={onSelect}
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
        <p
          className={`mt-1 text-xs font-medium ${
            provider.deliveryStatus === 'active'
              ? 'text-green-700 dark:text-green-300'
              : provider.deliveryStatus === 'preview'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-gray-600 dark:text-gray-300'
          }`}
        >
          {NOTIFICATION_DELIVERY_STATUS_LABELS[provider.deliveryStatus]}
        </p>
      </div>

      <div className='flex flex-col items-end gap-3 sm:flex-row sm:items-center'>
        <div className='flex items-center gap-2'>
          <span
            className={`text-xs font-medium ${
              channel.enabled
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {channel.enabled ? '启用' : '关闭'}
          </span>
          {provider.capabilities.canToggle && (
            <NotificationToggleSwitch
              checked={channel.enabled}
              disabled={pending || saving}
              label={`启停 ${channel.name}`}
              onClick={onToggle}
            />
          )}
        </div>

        {!batchMode && (
          <div className='flex flex-wrap justify-end gap-2'>
            {provider.capabilities.canTest && (
              <button
                type='button'
                disabled={pending || saving || !channel.enabled}
                onClick={onTest}
                className='inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
              >
                {pending ? (
                  <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
                ) : (
                  <Send className='h-3.5 w-3.5' />
                )}
                {testLabel}
              </button>
            )}
            {provider.capabilities.canEdit && (
              <button
                type='button'
                disabled={pending || saving}
                onClick={onEdit}
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
                onClick={onDelete}
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
}
