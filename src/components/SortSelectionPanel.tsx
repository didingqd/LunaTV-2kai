'use client';

/**
 * 通用排序设置面板（仿 APP MediaSortSheet）
 *
 * 修改点：从 ContinueWatchingSortPanel 提炼出的通用面板，
 * 选项列表、字段名称与方向文案由调用方参数化，供
 * 「继续观看」「收藏夹」等列表共用同一套交互与样式：
 * 点击当前字段切换升降序，点击新字段使用该字段默认方向；
 * 当前选中项显示方向箭头与方向文案。
 */

import { ArrowDown, ArrowUp, ArrowUpDown, Check, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface SortSelectionPanelProps<T extends string> {
  isOpen: boolean;
  /** 面板标题（默认「排序设置」） */
  title?: string;
  options: readonly T[];
  selection: { type: T; ascending: boolean };
  labelOf: (type: T) => string;
  directionLabelOf: (type: T, ascending: boolean) => string;
  onSelect: (type: T) => void;
  onClose: () => void;
}

export function SortSelectionPanel<T extends string>({
  isOpen,
  title = '排序设置',
  options,
  selection,
  labelOf,
  directionLabelOf,
  onSelect,
  onClose,
}: SortSelectionPanelProps<T>) {
  // ESC 键关闭（与 ConfirmDialog 行为一致）
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const panelContent = (
    <div className='fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in'>
      {/* 背景遮罩 */}
      <div
        className='absolute inset-0 bg-black/50 backdrop-blur-sm'
        onClick={onClose}
      />

      {/* 排序面板（animate-slide-up 类在项目中不存在，统一使用已有的 animate-fade-in） */}
      <div className='relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 animate-fade-in max-h-[80vh] overflow-y-auto'>
        {/* 标题 */}
        <div className='p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between'>
          <h2 className='text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2'>
            <ArrowUpDown className='w-5 h-5 text-blue-500' />
            {title}
          </h2>
          <button
            onClick={onClose}
            className='p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700'
            aria-label='关闭'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* 排序选项列表 */}
        <div className='p-2'>
          {options.map((type) => {
            const active = selection.type === type;
            return (
              <button
                key={type}
                onClick={() => onSelect(type)}
                className='w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50'
              >
                <span
                  className={`text-sm sm:text-base ${
                    active
                      ? 'font-semibold text-blue-600 dark:text-blue-400'
                      : 'font-normal text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {labelOf(type)}
                </span>
                {active && (
                  <>
                    {selection.ascending ? (
                      <ArrowUp className='w-4 h-4 text-blue-600 dark:text-blue-400' />
                    ) : (
                      <ArrowDown className='w-4 h-4 text-blue-600 dark:text-blue-400' />
                    )}
                    <span className='ml-auto flex items-center gap-2'>
                      <span className='text-xs sm:text-sm text-gray-400 dark:text-gray-500'>
                        {directionLabelOf(type, selection.ascending)}
                      </span>
                      <Check className='w-4 h-4 text-blue-600 dark:text-blue-400' />
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* 提示文案（与 APP 交互说明一致） */}
        <div className='px-5 pb-5 pt-1'>
          <p className='text-xs text-gray-400 dark:text-gray-500'>
            点击切换排序方式，再次点击当前方式可切换升降序
          </p>
        </div>
      </div>
    </div>
  );

  // 使用 Portal 渲染到 body，保证位于各弹窗之上
  return typeof document !== 'undefined'
    ? createPortal(panelContent, document.body)
    : null;
}

export default SortSelectionPanel;
