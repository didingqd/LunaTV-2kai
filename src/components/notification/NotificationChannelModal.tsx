'use client';

import { Check, X } from 'lucide-react';
import { createPortal } from 'react-dom';

import { NOTIFICATION_EVENT_METAS } from '@/lib/notification-event-bootstrap';

import {
  MOBILE_DIALOG_CONTENT_CLASS,
  MOBILE_DIALOG_FRAME_CLASS,
  MOBILE_DIALOG_HEADER_CLASS,
} from '../mobile-dialog-layout';
import {
  NOTIFICATION_DELIVERY_STATUS_LABELS,
  type NotificationProviderMeta,
} from '../notification-settings-provider-ui';
import { NotificationConfigSection } from './NotificationConfigSection';
import { NotificationEventSelector } from './NotificationEventSelector';
import { NotificationProviderPicker } from './NotificationProviderPicker';
import type {
  ChannelFormState,
  ChannelModalStep,
} from './notification-settings-types';

interface NotificationChannelModalProps {
  step: ChannelModalStep | null;
  form: ChannelFormState | null;
  provider: NotificationProviderMeta | null;
  creatableProviders: NotificationProviderMeta[];
  saving: boolean;
  valid: boolean;
  onClose: () => void;
  onPickProvider: (providerType: string) => void;
  onBackToPicker: () => void;
  onChangeForm: (next: ChannelFormState) => void;
  onToggleEvent: (eventType: string) => void;
  onSave: () => void;
}

// Modal is intentionally a controlled presentation component. The page retains
// all form state and API mutations, so splitting the UI cannot alter the
// existing channel create/edit flow.
export function NotificationChannelModal({
  step,
  form,
  provider,
  creatableProviders,
  saving,
  valid,
  onClose,
  onPickProvider,
  onBackToPicker,
  onChangeForm,
  onToggleEvent,
  onSave,
}: NotificationChannelModalProps) {
  if (!step) return null;

  const ProviderIcon = provider?.icon;
  const title =
    step === 'provider'
      ? '选择通知渠道'
      : form?.mode === 'edit'
        ? '编辑通知渠道'
        : '配置通知渠道';

  const dialog = (
    <>
      <div className='fixed inset-0 z-[1100] bg-black/50 backdrop-blur-sm' />
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='notification-channel-modal-title'
        className={`fixed left-1/2 top-1/2 z-[1101] flex max-h-[90vh] w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950 ${MOBILE_DIALOG_FRAME_CLASS}`}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800 ${MOBILE_DIALOG_HEADER_CLASS}`}
        >
          <div>
            <h3
              id='notification-channel-modal-title'
              className='text-xl font-bold text-gray-900 dark:text-gray-100'
            >
              {title}
            </h3>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              {step === 'provider'
                ? '选择一种通知方式，点击卡片后直接进入配置。'
                : '列表保持简洁，详细配置统一在弹窗中维护。'}
            </p>
          </div>
          <button
            type='button'
            aria-label='关闭'
            disabled={saving}
            onClick={onClose}
            className='rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto p-5 ${MOBILE_DIALOG_CONTENT_CLASS}`}
        >
          {step === 'provider' ? (
            <NotificationProviderPicker
              providers={creatableProviders}
              saving={saving}
              onPick={onPickProvider}
            />
          ) : form && provider && ProviderIcon ? (
            <div className='space-y-5'>
              <div className='flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/60'>
                <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'>
                  <ProviderIcon className='h-5 w-5' />
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

              <div
                role='status'
                className={`rounded-xl border px-4 py-3 text-sm ${
                  provider.deliveryStatus === 'active'
                    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-200'
                    : provider.deliveryStatus === 'preview'
                      ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
                      : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200'
                }`}
              >
                {NOTIFICATION_DELIVERY_STATUS_LABELS[provider.deliveryStatus]}
              </div>

              <NotificationConfigSection
                form={form}
                provider={provider}
                onChange={onChangeForm}
              />

              <NotificationEventSelector
                events={NOTIFICATION_EVENT_METAS}
                subscribedEvents={form.subscribedEvents}
                onToggle={onToggleEvent}
              />
            </div>
          ) : null}
        </div>

        <div className='flex shrink-0 flex-col-reverse gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800 sm:flex-row sm:justify-end'>
          {step === 'config' && form?.mode === 'create' && (
            <button
              type='button'
              disabled={saving}
              onClick={onBackToPicker}
              className='rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
            >
              重新选择
            </button>
          )}
          <button
            type='button'
            disabled={saving}
            onClick={onClose}
            className='rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900'
          >
            取消
          </button>
          {step === 'config' && (
            <button
              type='button'
              disabled={saving || !valid}
              onClick={onSave}
              className='inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'
            >
              {saving && <Check className='h-4 w-4 animate-pulse' />}
              保存渠道
            </button>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(dialog, document.body);
}
