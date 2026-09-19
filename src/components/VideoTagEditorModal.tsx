'use client';

/**
 * 【自定义标签·新增】视频自定义标签编辑弹窗（网页端）。
 *
 * 交互与 APP 端 VideoTagEditorSheet 对齐：
 * - 顶部输入框，回车把输入加入下方 chip（可连续添加多个）；
 * - 每个已确认标签 chip 右侧带 × ，点击直接删除；
 * - 「已有标签（点击添加）」区展示全局词表中尚未选中的标签，点击直接填入；
 * - 保存把标签列表交给调用方持久化（本组件不直接触碰存储/API）。
 *
 * 弹窗骨架（Portal + 遮罩 + 居中卡片 + ESC/X 关闭）复用站内 SortSelectionPanel
 * 的样式约定，保证与其他弹窗视觉一致、暗色适配。
 */

import { Check, Plus, Tag, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_VIDEO,
  normalizeTagList,
} from '@/lib/video-tags.client';

interface VideoTagEditorModalProps {
  /** 当前内容已有的标签。 */
  initialTags: string[];
  /** 全局标签词表（供点击复用；组件内部会去掉已选项）。 */
  suggestedTags: string[];
  /** 保存回调：传入规整后的标签列表（可能为空 = 清空全部标签）。 */
  onSave: (tags: string[]) => void;
  onClose: () => void;
}

export function VideoTagEditorModal({
  initialTags,
  suggestedTags,
  onSave,
  onClose,
}: VideoTagEditorModalProps) {
  // 组件由父级「按需挂载」（打开才渲染），因此直接用 props 初始化即可，
  // 无需在 effect 里同步 state（避免 react-hooks/set-state-in-effect）。
  const [tags, setTags] = useState<string[]>(() =>
    normalizeTagList(initialTags),
  );
  const [input, setInput] = useState('');

  // ESC 关闭（与 SortSelectionPanel 行为一致）。挂载期间始终生效。
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const addTag = (raw: string) => {
    if (!raw.trim()) return;
    if (tags.length >= MAX_TAGS_PER_VIDEO) return;
    setTags((prev) => normalizeTagList([...prev, raw]));
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(input);
      setInput('');
    }
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSave = () => {
    // 提交前把输入框里尚未回车确认的残留内容也纳入。
    const finalTags =
      input.trim() && tags.length < MAX_TAGS_PER_VIDEO
        ? normalizeTagList([...tags, input])
        : tags;
    onSave(finalTags);
    onClose();
  };

  // 建议区：全局词表去掉已选。
  const remainingSuggestions = suggestedTags.filter((t) => !tags.includes(t));

  const panelContent = (
    <div className='fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in'>
      <div
        className='absolute inset-0 bg-black/50 backdrop-blur-sm'
        onClick={onClose}
      />

      <div className='relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 animate-fade-in max-h-[80vh] overflow-y-auto'>
        {/* 标题 */}
        <div className='p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between'>
          <h2 className='text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2'>
            <Tag className='w-5 h-5 text-orange-500' />
            编辑标签
          </h2>
          <button
            onClick={onClose}
            className='p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700'
            aria-label='关闭'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        <div className='p-5'>
          <p className='text-xs text-gray-400 dark:text-gray-500 mb-3'>
            输入后回车即添加一个标签，可连续添加多个；标签会进入收藏夹筛选项，与
            App 端全局共用。
          </p>

          {/* 输入行 */}
          <div className='flex items-center gap-2'>
            <input
              type='text'
              value={input}
              autoFocus
              maxLength={MAX_TAG_LENGTH}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder='如：动漫、国产剧'
              className='flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500'
            />
            <button
              onClick={() => {
                addTag(input);
                setInput('');
              }}
              className='p-2 rounded-lg text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors'
              aria-label='添加标签'
            >
              <Plus className='w-6 h-6' />
            </button>
          </div>

          {/* 已确认标签 chip（右侧 × 删除） */}
          <div className='mt-4'>
            {tags.length === 0 ? (
              <p className='text-sm text-gray-400 dark:text-gray-500'>
                暂无标签
              </p>
            ) : (
              <div className='flex flex-wrap gap-2'>
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className='inline-flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100'
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className='p-0.5 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors'
                      aria-label={`删除标签 ${tag}`}
                    >
                      <X className='w-3.5 h-3.5 text-gray-500 dark:text-gray-400' />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 已有标签建议区（点击添加） */}
          {remainingSuggestions.length > 0 && (
            <div className='mt-5'>
              <p className='text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2'>
                已有标签（点击添加）
              </p>
              <div className='flex flex-wrap gap-2'>
                {remainingSuggestions.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => addTag(tag)}
                    className='inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-orange-400/60 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors'
                  >
                    <Plus className='w-3.5 h-3.5' />
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className='px-5 pb-5 flex items-center justify-end gap-2'>
          <button
            onClick={onClose}
            className='px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className='px-4 py-2 rounded-lg text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors flex items-center gap-1.5'
          >
            <Check className='w-4 h-4' />
            保存
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(panelContent, document.body)
    : null;
}

export default VideoTagEditorModal;
