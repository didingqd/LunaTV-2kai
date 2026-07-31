'use client';

import {
  AlertCircle,
  CheckCircle2,
  Eye,
  LoaderCircle,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import {
  AdminWatchingUpdateCheckLogsApiError,
  getAdminWatchingUpdateCheckLogs,
} from '@/lib/api/admin-watching-update-check-logs';
import type {
  WatchingUpdateCheckLogEntry,
  WatchingUpdateCheckLogOperation,
  WatchingUpdateCheckLogSource,
} from '@/lib/watching-update-check-log-types';

type SourceFilter = 'all' | WatchingUpdateCheckLogSource;
type OperationFilter = 'all' | WatchingUpdateCheckLogOperation;

const sourceLabels: Record<WatchingUpdateCheckLogSource, string> = {
  cron: 'Cron任务',
  app: 'App',
  web: '网页',
  admin: '管理员',
  trigger: '追更链接',
};

const sourceOptions: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: '全部来源' },
  ...Object.entries(sourceLabels).map(([value, label]) => ({
    value: value as WatchingUpdateCheckLogSource,
    label,
  })),
];

const operationOptions: Array<{ value: OperationFilter; label: string }> = [
  { value: 'all', label: '????' },
  { value: 'check', label: 'check' },
  { value: 'scheduled-check', label: 'scheduled-check' },
  { value: 'sync', label: 'sync' },
  { value: 'manual-trigger', label: 'manual-trigger' },
];

function formatDate(value?: number): string {
  if (!value || !Number.isFinite(value)) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value} ms`
    : '-';
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function displaySource(
  value: WatchingUpdateCheckLogSource | undefined,
): string {
  if (!value) return '-';
  return sourceLabels[value] ?? value;
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '-';
  }
}

function readFormControlValue(control: Element | RadioNodeList | null): string {
  if (control && typeof control === 'object' && 'value' in control) {
    return String(control.value);
  }
  return '';
}

function DetailItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div className='min-w-0'>
      <dt className='text-xs font-medium text-gray-500 dark:text-gray-400'>
        {label}
      </dt>
      <dd className='mt-1 break-words text-sm text-gray-900 dark:text-gray-100'>
        {displayValue(value)}
      </dd>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className='max-h-56 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs leading-5 text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'>
      {formatJson(value)}
    </pre>
  );
}

function LogDetailsModal({
  entry,
  onClose,
}: {
  entry: WatchingUpdateCheckLogEntry;
  onClose: () => void;
}) {
  const updates = entry.result?.updates ?? [];

  return (
    <div
      className='fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4'
      role='dialog'
      aria-modal='true'
      aria-labelledby='watching-update-check-log-detail-title'
    >
      <div className='max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800'>
        <div className='sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-800'>
          <h3
            id='watching-update-check-log-detail-title'
            className='text-lg font-semibold text-gray-900 dark:text-gray-100'
          >
            追更检查日志详情
          </h3>
          <button
            type='button'
            onClick={onClose}
            className='rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100'
            aria-label='关闭详情'
            title='关闭详情'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='space-y-6 p-5'>
          <section>
            <h4 className='mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100'>
              Request
            </h4>
            <dl className='grid gap-4 sm:grid-cols-2'>
              <DetailItem label='method' value={entry.request?.method} />
              <DetailItem label='path' value={entry.request?.path} />
              <DetailItem label='userId' value={entry.request?.userId} />
              <DetailItem label='source' value={displaySource(entry.source)} />
              {/* Stage 4H-H: show JobRunner audit metadata so cron runners,
                  trigger links, and future app calls can be distinguished in
                  the existing log detail view without adding another log type. */}
              <DetailItem
                label='requestedBy'
                value={entry.request?.requestedBy}
              />
              <DetailItem label='trigger' value={entry.request?.trigger} />
            </dl>
            <div className='mt-4'>
              <div className='mb-1 text-xs font-medium text-gray-500 dark:text-gray-400'>
                client
              </div>
              <JsonBlock value={entry.request?.client} />
            </div>
            <div className='mt-4'>
              <div className='mb-1 text-xs font-medium text-gray-500 dark:text-gray-400'>
                body
              </div>
              <JsonBlock value={entry.request?.body} />
            </div>
          </section>

          <section>
            <h4 className='mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100'>
              Execution
            </h4>
            <dl className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
              <DetailItem
                label='startedAt'
                value={formatDate(entry.execution?.startedAt)}
              />
              <DetailItem label='stage' value={entry.execution?.stage} />
              <DetailItem
                label='endedAt'
                value={formatDate(entry.execution?.endedAt)}
              />
              <DetailItem
                label='finishedAt'
                value={formatDate(
                  entry.execution?.finishedAt ?? entry.execution?.endedAt,
                )}
              />
              <DetailItem
                label='durationMs'
                value={formatDuration(entry.execution?.durationMs)}
              />
              <DetailItem
                label='success'
                value={entry.execution?.success ? 'true' : 'false'}
              />
              <DetailItem label='error' value={entry.execution?.error} />
            </dl>
          </section>

          <section>
            <h4 className='mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100'>
              Result
            </h4>
            <dl className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <DetailItem
                label='checkedCount'
                value={entry.result?.checkedCount}
              />
              <DetailItem
                label='successCount'
                value={entry.result?.successCount}
              />
              <DetailItem
                label='failureCount'
                value={entry.result?.failureCount}
              />
              <DetailItem
                label='updateFoundCount'
                value={entry.result?.updateFoundCount}
              />
            </dl>
            <div className='mt-4'>
              <JsonBlock value={entry.result} />
            </div>
          </section>

          <section>
            <h4 className='mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100'>
              Updates
            </h4>
            {updates.length === 0 ? (
              <p className='text-sm text-gray-500 dark:text-gray-400'>-</p>
            ) : (
              <div className='overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700'>
                <table className='min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700'>
                  <thead className='bg-gray-50 dark:bg-gray-900/50'>
                    <tr>
                      {[
                        'resourceId',
                        'title',
                        'oldEpisode',
                        'newEpisode',
                        'source',
                      ].map((label) => (
                        <th
                          key={label}
                          className='px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400'
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                    {updates.map((update, index) => (
                      <tr key={`${update.resourceId}-${index}`}>
                        <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                          {displayValue(update.resourceId)}
                        </td>
                        <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                          {displayValue(update.title)}
                        </td>
                        <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                          {displayValue(update.oldEpisode)}
                        </td>
                        <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                          {displayValue(update.newEpisode)}
                        </td>
                        <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                          {displayValue(update.source)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function WatchingUpdateCheckLogViewer() {
  const [source, setSource] = useState<SourceFilter>('all');
  const [operation, setOperation] = useState<OperationFilter>('all');
  const [userId, setUserId] = useState('');
  const [query, setQuery] = useState<{
    source: SourceFilter;
    userId: string;
  }>({ source: 'all', userId: '' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [logs, setLogs] = useState<WatchingUpdateCheckLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] =
    useState<WatchingUpdateCheckLogEntry | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getAdminWatchingUpdateCheckLogs({
        limit: 200,
        source: query.source === 'all' ? undefined : query.source,
        userId: query.userId || undefined,
      });
      setLogs(Array.isArray(response.logs) ? response.logs : []);
    } catch (loadError) {
      setLogs([]);
      if (
        loadError instanceof AdminWatchingUpdateCheckLogsApiError &&
        loadError.status === 403
      ) {
        setError('无权查看追更检查日志。');
      } else {
        setError(
          loadError instanceof Error
            ? loadError.message
            : '加载追更检查日志失败。',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [query, refreshKey]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(
    () =>
      operation === 'all'
        ? logs
        : logs.filter((log) => log.operation === operation),
    [logs, operation],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sourceElement = event.currentTarget.elements.namedItem('source');
    const userIdElement = event.currentTarget.elements.namedItem('userId');
    const submittedSource = readFormControlValue(sourceElement);
    const submittedUserId = readFormControlValue(userIdElement).trim();
    const nextSource: SourceFilter =
      submittedSource === 'cron' ||
      submittedSource === 'app' ||
      submittedSource === 'web' ||
      submittedSource === 'admin'
        ? submittedSource
        : 'all';
    setSource(nextSource);
    setUserId(submittedUserId);
    setQuery({
      source: nextSource,
      userId: submittedUserId,
    });
    setRefreshKey((current) => current + 1);
  };

  return (
    <div className='mt-6 border-t border-gray-200 pt-6 dark:border-gray-700'>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h4 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
            追更检查日志
          </h4>
          <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            显示最近 200 条检查记录。
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className='mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
      >
        <label className='block'>
          <span className='mb-1 block text-sm text-gray-700 dark:text-gray-300'>
            来源
          </span>
          <select
            name='source'
            value={source}
            onChange={(event) => setSource(event.target.value as SourceFilter)}
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          >
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className='block'>
          <span className='mb-1 block text-sm text-gray-700 dark:text-gray-300'>
            操作
          </span>
          <select
            value={operation}
            onChange={(event) =>
              setOperation(event.target.value as OperationFilter)
            }
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          >
            {operationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className='block'>
          <span className='mb-1 block text-sm text-gray-700 dark:text-gray-300'>
            用户
          </span>
          <input
            name='userId'
            type='text'
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder='userId'
            className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          />
        </label>

        <button
          type='submit'
          disabled={loading}
          className='mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
        >
          {loading ? (
            <LoaderCircle className='h-4 w-4 animate-spin' />
          ) : (
            <RefreshCw className='h-4 w-4' />
          )}
          刷新
        </button>
      </form>

      {error && (
        <div className='mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'>
          <AlertCircle className='h-4 w-4 shrink-0' />
          {error}
        </div>
      )}

      {loading ? (
        <div className='flex items-center gap-2 py-8 text-sm text-gray-500 dark:text-gray-400'>
          <LoaderCircle className='h-4 w-4 animate-spin' />
          正在加载追更检查日志
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className='rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400'>
          暂无追更检查日志。
        </div>
      ) : (
        <div className='max-h-[500px] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700'>
          <table className='min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700'>
            <thead className='sticky top-0 z-10 bg-gray-50 dark:bg-gray-900'>
              <tr>
                {[
                  '时间',
                  '来源',
                  '操作',
                  '用户',
                  '耗时',
                  '状态',
                  '检查数量',
                  '更新数量',
                  '详情',
                ].map((label) => (
                  <th
                    key={label}
                    className='whitespace-nowrap px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400'
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800'>
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td className='whitespace-nowrap px-3 py-3 text-gray-900 dark:text-gray-100'>
                    {formatDate(log.execution?.startedAt)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300'>
                    {displaySource(log.source)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300'>
                    {displayValue(log.operation)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300'>
                    {displayValue(log.request?.userId)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300'>
                    {formatDuration(log.execution?.durationMs)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-3'>
                    {log.execution?.success === true ? (
                      <span className='inline-flex items-center gap-1 text-green-700 dark:text-green-400'>
                        <CheckCircle2 className='h-4 w-4' />
                        成功
                      </span>
                    ) : log.execution?.success === false ? (
                      <span className='inline-flex items-center gap-1 text-red-700 dark:text-red-400'>
                        <XCircle className='h-4 w-4' />
                        失败
                      </span>
                    ) : (
                      <span className='text-gray-500 dark:text-gray-400'>
                        -
                      </span>
                    )}
                  </td>
                  <td className='whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300'>
                    {displayValue(log.result?.checkedCount)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300'>
                    {displayValue(log.result?.updateFoundCount)}
                  </td>
                  <td className='whitespace-nowrap px-3 py-3'>
                    <button
                      type='button'
                      onClick={() => setSelectedLog(log)}
                      className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30'
                    >
                      <Eye className='h-4 w-4' />
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedLog && (
        <LogDetailsModal
          entry={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
}
