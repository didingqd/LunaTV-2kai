'use client';

import { CalendarClock, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';

import PageLayout from '@/components/PageLayout';
import {
  useDeleteWatchingFollowMutation,
  useRefreshWatchingFollows,
  useWatchingFollowsArrayQuery,
} from '@/hooks/useWatchingFollows';
import { useSourcesQuery } from '@/hooks/useSourcesQuery';
import { processImageUrl } from '@/lib/utils';

export default function FollowsPage() {
  const {
    data: follows = [],
    isLoading,
    isFetching,
    error,
  } = useWatchingFollowsArrayQuery();
  const { data: sources = [] } = useSourcesQuery();
  const deleteMutation = useDeleteWatchingFollowMutation();
  const refresh = useRefreshWatchingFollows();
  const sourceNames = new Map(
    sources.map((source) => [source.key, source.name || source.key]),
  );

  return (
    <PageLayout activePath='/follows'>
      <main className='mx-auto min-h-screen w-full max-w-7xl px-4 pb-24 pt-20 sm:px-6 lg:px-8'>
        <header className='mb-6 flex items-center justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-white'>
              我的追更
            </h1>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              {follows.length} 个关注项目
            </p>
          </div>
          <button
            type='button'
            onClick={() => void refresh()}
            disabled={isFetching}
            className='inline-flex size-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
            aria-label='刷新追更列表'
            title='刷新'
          >
            <RefreshCw
              className={`size-4 ${isFetching ? 'animate-spin' : ''}`}
            />
          </button>
        </header>

        {isLoading ? (
          <div className='flex min-h-64 items-center justify-center'>
            <LoaderCircle className='size-7 animate-spin text-green-500' />
          </div>
        ) : error ? (
          <div className='border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'>
            {error instanceof Error ? error.message : '追更列表加载失败'}
          </div>
        ) : follows.length === 0 ? (
          <div className='flex min-h-64 flex-col items-center justify-center border border-dashed border-gray-300 px-6 text-center dark:border-gray-700'>
            <CalendarClock className='mb-3 size-8 text-gray-400' />
            <p className='font-medium text-gray-700 dark:text-gray-200'>
              暂无追更
            </p>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              在播放详情页点击“追更”即可添加
            </p>
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'>
            {follows.map((follow) => {
              const href = `/play?source=${encodeURIComponent(follow.source)}&id=${encodeURIComponent(follow.id)}&title=${encodeURIComponent(follow.title)}&year=${encodeURIComponent(follow.year)}`;
              const deleting =
                deleteMutation.isPending &&
                deleteMutation.variables?.source === follow.source &&
                deleteMutation.variables?.id === follow.id;
              return (
                <article
                  key={`${follow.source}+${follow.id}`}
                  className='group relative overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
                >
                  <Link href={href} className='block'>
                    <div className='aspect-[2/3] overflow-hidden bg-gray-100 dark:bg-gray-800'>
                      {follow.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={processImageUrl(follow.cover)}
                          alt={follow.title}
                          className='h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]'
                          loading='lazy'
                        />
                      ) : (
                        <div className='flex h-full items-center justify-center px-3 text-center text-sm text-gray-400'>
                          {follow.title}
                        </div>
                      )}
                    </div>
                    <div className='space-y-1 p-3 pr-10'>
                      <h2 className='truncate text-sm font-semibold text-gray-900 dark:text-white'>
                        {follow.title}
                      </h2>
                      <p className='truncate text-xs text-gray-500 dark:text-gray-400'>
                        {sourceNames.get(follow.source) || follow.source}
                      </p>
                      <p className='text-xs text-gray-500 dark:text-gray-400'>
                        {follow.year || '年份未知'} ·{' '}
                        {formatCreatedAt(follow.createdAt)}
                      </p>
                    </div>
                  </Link>
                  <button
                    type='button'
                    onClick={() =>
                      deleteMutation.mutate({
                        source: follow.source,
                        id: follow.id,
                      })
                    }
                    disabled={deleting}
                    className='absolute right-2 bottom-2 inline-flex size-8 items-center justify-center rounded-md bg-white/90 text-gray-500 shadow-sm transition-colors hover:text-red-500 disabled:cursor-wait disabled:opacity-60 dark:bg-gray-800/90 dark:text-gray-300'
                    aria-label={`取消追更 ${follow.title}`}
                    title='取消追更'
                  >
                    {deleting ? (
                      <LoaderCircle className='size-4 animate-spin' />
                    ) : (
                      <Trash2 className='size-4' />
                    )}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </PageLayout>
  );
}

function formatCreatedAt(value: number): string {
  const milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(milliseconds));
}
