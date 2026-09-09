'use client';

import { RotateCcw } from 'lucide-react';
import { useMemo, useRef } from 'react';

// 修改点：客户端直接复用服务端同一套模板渲染函数，保证预览与实际发送一致
import { renderNotificationTemplate } from '@/lib/notification/notification-template';

import type { ChannelFormState } from './notification-settings-types';

interface NotificationTemplateSectionProps {
  form: ChannelFormState;
  templateVariables: NotificationTemplateVariablesProp;
  onChange: (next: ChannelFormState) => void;
}

export interface NotificationTemplateVariablesProp {
  variables: Array<{
    name: string;
    description: string;
    sample: string;
    snippet?: string;
  }>;
}

// 通知内容模板编辑区：textarea + 变量块（点击填入完整块）+ 恢复默认 + 实时预览。
// 受控组件：全部状态由父级 ChannelFormState 持有。
export function NotificationTemplateSection({
  form,
  templateVariables,
  onChange,
}: NotificationTemplateSectionProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(() => {
    if (!templateVariables?.variables?.length) return '';
    const samples = Object.fromEntries(
      templateVariables.variables.map((variable) => [
        variable.name,
        variable.sample,
      ]),
    );
    // 修改点：预览用各变量示例值渲染当前模板，与服务端渲染规则完全一致
    return renderNotificationTemplate(form.contentTemplate, samples);
  }, [form.contentTemplate, templateVariables]);

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange({ ...form, contentTemplate: form.contentTemplate + text });
      return;
    }
    const start = textarea.selectionStart ?? form.contentTemplate.length;
    const end = textarea.selectionEnd ?? start;
    const next =
      form.contentTemplate.slice(0, start) +
      text +
      form.contentTemplate.slice(end);
    onChange({ ...form, contentTemplate: next });
    // 插入后把光标移到插入内容之后
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const restoreDefault = () => {
    onChange({ ...form, contentTemplate: form.defaultContentTemplate });
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  if (!templateVariables?.variables?.length) return null;

  return (
    <section className='space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
          通知内容模板
        </h4>
        <button
          type='button'
          onClick={restoreDefault}
          className='inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900'
        >
          <RotateCcw className='h-3 w-3' />
          恢复默认模板
        </button>
      </div>

      <p className='text-xs leading-5 text-gray-500 dark:text-gray-400'>
        使用
        <code className='mx-1 rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-900'>
          {'{{变量名}}'}
        </code>
        插入变量；使用
        <code className='mx-1 rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-900'>
          {'{{#变量}}...{{/变量}}'}
        </code>
        条件区块（变量为空时整段不显示）。留空表示使用默认模板。
      </p>

      <div className='flex flex-wrap gap-2'>
        {/* 修改点：点击变量填入完整块（列表类变量为含标题行与条件区块的整段） */}
        {templateVariables.variables.map((variable) => (
          <button
            key={variable.name}
            type='button'
            title={variable.description}
            onClick={() =>
              insertAtCursor(variable.snippet ?? `{{${variable.name}}}`)
            }
            className='inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40'
          >
            {`{{${variable.name}}}`}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        aria-label='通知内容模板'
        value={form.contentTemplate}
        rows={10}
        onChange={(event) =>
          onChange({ ...form, contentTemplate: event.target.value })
        }
        spellCheck={false}
        className='w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-mono text-xs leading-5 text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
        placeholder={form.defaultContentTemplate}
      />

      <div>
        <div className='mb-1 text-xs font-medium text-gray-500 dark:text-gray-400'>
          预览（使用示例数据渲染）
        </div>
        <pre className='max-h-60 overflow-auto whitespace-pre-wrap rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-700 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300'>
          {preview || '（模板渲染结果为空）'}
        </pre>
      </div>
    </section>
  );
}
