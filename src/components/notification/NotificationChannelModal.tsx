import { Check, X } from 'lucide-react';

import {
  NOTIFICATION_EVENT_METAS,
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

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm'>
      <div className='max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950'>
        <div className='flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800'>
          <div>
            <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
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
        <div className='max-h-[calc(88vh-5rem)] overflow-y-auto p-5'>
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

              {!provider.capabilities.canSend && (
                <div
                  role='status'
                  className='rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
                >
                  可保存并校验配置，发送能力待实现。
                </div>
              )}

              <NotificationConfigSection
                form={form}
                provider={provider}
                onChange={onChangeForm}
              />

              {form.mode === 'edit' && (
                <NotificationEventSelector
                  events={NOTIFICATION_EVENT_METAS}
                  subscribedEvents={form.subscribedEvents}
                  onToggle={onToggleEvent}
                />
              )}

              <section className='space-y-3'>
                <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  高级设置
                </h4>
                <div className='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
                  当前渠道暂未提供额外高级设置。
                </div>
              </section>

              <div className='flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end'>
                {form.mode === 'create' && (
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
                <button
                  type='button'
                  disabled={saving || !valid}
                  onClick={onSave}
                  className='inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400'
                >
                  {saving && <Check className='h-4 w-4 animate-pulse' />}
                  保存渠道
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
