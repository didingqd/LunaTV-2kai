'use client';

import { Check } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  useSaveWatchCompletionThresholdMutation,
  useWatchCompletionThresholdQuery,
} from '@/hooks/useUserMenuQueries';
import {
  DEFAULT_WATCH_COMPLETION_THRESHOLD,
  sanitizeWatchCompletionThreshold,
} from '@/lib/watching-update-calculation';

interface WatchCompletionThresholdSettingProps {
  username?: string | null;
}

export const WatchCompletionThresholdSetting = memo(
  ({ username }: WatchCompletionThresholdSettingProps) => {
    const principal = username?.trim() || null;
    const thresholdQuery = useWatchCompletionThresholdQuery({
      enabled: !!principal,
      username: principal,
    });
    const saveThresholdMutation =
      useSaveWatchCompletionThresholdMutation(principal);
    const [savedThreshold, setSavedThreshold] = useState(
      DEFAULT_WATCH_COMPLETION_THRESHOLD,
    );
    const [draftThreshold, setDraftThreshold] = useState(
      DEFAULT_WATCH_COMPLETION_THRESHOLD,
    );
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
      const nextThreshold = sanitizeWatchCompletionThreshold(
        thresholdQuery.data,
      );
      setSavedThreshold(nextThreshold);
      setDraftThreshold(nextThreshold);
      setSaveError(null);
    }, [principal, thresholdQuery.data]);

    if (!principal) return null;

    const isDirty = draftThreshold !== savedThreshold;
    const isSaving = saveThresholdMutation.isPending;

    const handleThresholdChange = (value: string) => {
      setSaveError(null);
      setDraftThreshold(sanitizeWatchCompletionThreshold(value));
    };

    const handleSave = async () => {
      const previousThreshold = savedThreshold;
      const nextThreshold = sanitizeWatchCompletionThreshold(draftThreshold);
      setSaveError(null);

      try {
        const persistedThreshold =
          await saveThresholdMutation.mutateAsync(nextThreshold);
        setSavedThreshold(persistedThreshold);
        setDraftThreshold(persistedThreshold);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '观看完成判定保存失败';
        // 修改点：保存失败时恢复到最后一次成功同步的当前账号值，避免失败草稿误导本地追更计算。
        setDraftThreshold(previousThreshold);
        setSaveError(message);
        toast.error(message);
      }
    };

    return (
      <div
        className='space-y-3'
        data-testid='watch-completion-threshold-setting'
      >
        <div className='flex items-start justify-between gap-4'>
          <div>
            <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              观看完成判定：{draftThreshold}%
            </h4>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              达到该播放比例后，该集会被认为已经观看完成，并用于追更计算和更新提醒。
            </p>
          </div>
          <button
            type='button'
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors flex items-center gap-1.5 ${
              isDirty && !isSaving
                ? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/30'
                : 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500'
            }`}
          >
            <Check className='w-3.5 h-3.5' />
            {isSaving ? '保存中' : '保存'}
          </button>
        </div>

        <input
          aria-label='观看完成判定'
          type='range'
          min='0'
          max='100'
          step='1'
          value={draftThreshold}
          disabled={isSaving}
          onChange={(event) => handleThresholdChange(event.target.value)}
          className='w-full accent-green-500'
        />

        <div className='flex justify-between text-xs text-gray-400 dark:text-gray-500'>
          <span>0%</span>
          <span>100%</span>
        </div>

        {thresholdQuery.isFetching && (
          <p className='text-xs text-gray-400 dark:text-gray-500'>
            正在同步当前账号设置...
          </p>
        )}
        {saveError && (
          <p className='text-xs text-red-500 dark:text-red-400'>{saveError}</p>
        )}
      </div>
    );
  },
);

WatchCompletionThresholdSetting.displayName = 'WatchCompletionThresholdSetting';
