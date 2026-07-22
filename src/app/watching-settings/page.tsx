'use client';

import { Check, CloudCog, Laptop } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { BackButton } from '@/components/BackButton';
import PageLayout from '@/components/PageLayout';
import {
  readWatchingUpdateSourceMode,
  subscribeWatchingUpdateSourceMode,
  writeWatchingUpdateSourceMode,
  type WatchingUpdateSourceMode,
} from '@/lib/watching-update-preference';

const MODE_OPTIONS: Array<{
  mode: WatchingUpdateSourceMode;
  title: string;
  description: string;
  icon: typeof Laptop;
}> = [
  {
    mode: 'local',
    title: '本地计算',
    description: '由浏览器检测资源更新。',
    icon: Laptop,
  },
  {
    mode: 'backend',
    title: '后端获取 + 本地核验',
    description: '优先读取服务器结果，并在后台校验资源。',
    icon: CloudCog,
  },
];

export default function WatchingSettingsPage() {
  const sourceMode = useSyncExternalStore(
    subscribeWatchingUpdateSourceMode,
    readWatchingUpdateSourceMode,
    (): WatchingUpdateSourceMode => 'local',
  );

  return (
    <PageLayout activePath='/watching-settings'>
      <main className='mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10'>
        <div className='mb-8 flex items-center gap-3'>
          <BackButton />
          <div className='min-w-0'>
            <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100 sm:text-2xl'>
              追更设置
            </h1>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              更新获取方式
            </p>
          </div>
        </div>

        <section aria-labelledby='watching-update-mode-heading'>
          <h2
            id='watching-update-mode-heading'
            className='mb-3 text-sm font-medium text-gray-700 dark:text-gray-300'
          >
            获取方式
          </h2>
          <div className='divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900'>
            {MODE_OPTIONS.map((option) => {
              const selected = sourceMode === option.mode;
              const Icon = option.icon;
              return (
                <label
                  key={option.mode}
                  className='flex min-h-24 w-full cursor-pointer items-start gap-3 px-4 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/70 sm:items-center sm:px-5'
                >
                  <input
                    type='radio'
                    name='watching-update-source-mode'
                    value={option.mode}
                    checked={selected}
                    onChange={() => writeWatchingUpdateSourceMode(option.mode)}
                    className='sr-only'
                  />
                  <span className='mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 sm:mt-0'>
                    <Icon className='h-5 w-5' />
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {option.title}
                    </span>
                    <span className='mt-1 block text-sm leading-5 text-gray-500 dark:text-gray-400'>
                      {option.description}
                    </span>
                  </span>
                  <span
                    className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border sm:mt-0 ${
                      selected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 text-transparent dark:border-gray-600'
                    }`}
                    aria-hidden='true'
                  >
                    <Check className='h-3.5 w-3.5' />
                  </span>
                </label>
              );
            })}
          </div>
          <p className='mt-3 text-sm text-gray-500 dark:text-gray-400'>
            {sourceMode === 'local'
              ? '当前使用本地计算。'
              : '后端不可用或当前账号未授权时，将自动使用本地计算。'}
          </p>
        </section>
      </main>
    </PageLayout>
  );
}
