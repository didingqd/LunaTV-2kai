'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const DISMISS_STORAGE_KEY = 'translation-warning-dismissed';

/**
 * 修改点：检测频繁 DOM 错误并提示用户关闭浏览器翻译功能，
 * 避免翻译插件改写 DOM 后影响页面卸载或路由切换。
 */
export function TranslationWarningToast() {
  const [showWarning, setShowWarning] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // 修改点：尊重用户“不再提示”选择，避免全站反复弹出翻译插件提醒。
    let permanentlyDismissed = false;
    try {
      permanentlyDismissed =
        localStorage.getItem(DISMISS_STORAGE_KEY) === 'true';
    } catch (err) {
      console.warn('[TranslationWarning] 无法读取提示关闭状态:', err);
    }

    if (permanentlyDismissed) {
      return;
    }

    const ERROR_THRESHOLD = 3; // 修改点：60 秒内 3 次 DOM 错误后再提示，降低误报。
    const TIME_WINDOW = 60000;

    const errorTimestamps: number[] = [];

    const handleError = (event: ErrorEvent) => {
      const error = event.error;

      const isDOMError =
        error?.name === 'NotFoundError' ||
        error?.message?.includes('removeChild') ||
        error?.message?.includes('The object can not be found here') ||
        error?.message?.includes('Node was not found') ||
        error?.message?.includes("Failed to execute 'removeChild'");

      if (isDOMError) {
        const now = Date.now();
        errorTimestamps.push(now);

        // 修改点：只保留时间窗口内的 DOM 错误记录，避免单次偶发错误触发提示。
        while (
          errorTimestamps.length > 0 &&
          now - errorTimestamps[0] > TIME_WINDOW
        ) {
          errorTimestamps.shift();
        }

        // 修改点：仅在短时间内连续命中阈值后显示提示，减少与正常页面提示的干扰。
        if (errorTimestamps.length >= ERROR_THRESHOLD && !dismissed) {
          setShowWarning(true);
          console.warn(
            '[TranslationWarning] 检测到频繁的翻译插件冲突，显示用户提示',
          );
        }
      }
    };

    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('error', handleError);
    };
  }, [dismissed]);

  const handleDismiss = (permanent: boolean) => {
    setShowWarning(false);
    setDismissed(true);

    if (permanent) {
      try {
        localStorage.setItem(DISMISS_STORAGE_KEY, 'true');
      } catch (err) {
        console.warn('[TranslationWarning] 无法保存提示关闭状态:', err);
      }
    }
  };

  if (!showWarning) return null;

  return (
    <div
      role='alert'
      className='fixed left-1/2 top-16 z-[9999] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 sm:top-20'
    >
      <div className='max-h-[60vh] animate-slide-down overflow-y-auto rounded-lg border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-orange-50 p-4 shadow-xl dark:border-amber-600 dark:from-amber-900/30 dark:to-orange-900/30'>
        {/* 修改点：关闭按钮保持紧凑定位，避免遮挡标题正文。 */}
        <button
          type='button'
          onClick={() => handleDismiss(false)}
          className='absolute right-2 top-2 rounded p-1 text-amber-600 transition-colors hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200'
          aria-label='关闭'
        >
          <X className='h-5 w-5' />
        </button>

        <div className='mb-3 flex items-start gap-3'>
          <div className='mt-0.5 flex-shrink-0'>
            {/* 修改点：使用 lucide 图标，保持与项目图标体系一致。 */}
            <AlertTriangle
              className='h-6 w-6 text-amber-600 dark:text-amber-400'
              aria-hidden='true'
            />
          </div>
          <div className='min-w-0 flex-1'>
            <h3 className='mb-1 pr-7 font-semibold text-amber-900 dark:text-amber-100'>
              检测到浏览器翻译干扰
            </h3>
            <p className='mb-3 text-sm leading-relaxed text-amber-800 dark:text-amber-200'>
              您的浏览器翻译功能可能影响页面正常显示。建议关闭自动翻译以获得最佳体验。
            </p>

            <div className='mb-3 space-y-1 rounded bg-white/50 p-3 text-xs text-amber-900 dark:bg-black/20 dark:text-amber-100'>
              <p className='mb-1 font-medium'>如何关闭：</p>
              <p>
                • <strong>Chrome/Edge：</strong>右键页面 → 取消"翻译为中文"
              </p>
              <p>
                • <strong>Safari：</strong>地址栏 → 点击"翻译"图标 → 关闭
              </p>
              <p>
                • <strong>插件：</strong>暂时禁用翻译扩展
              </p>
            </div>

            <div className='flex gap-2'>
              <button
                type='button'
                onClick={() => handleDismiss(false)}
                className='flex-1 rounded bg-white px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:bg-gray-800 dark:text-amber-300 dark:hover:bg-gray-700'
              >
                知道了
              </button>
              <button
                type='button'
                onClick={() => handleDismiss(true)}
                className='flex-1 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600'
              >
                不再提示
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
