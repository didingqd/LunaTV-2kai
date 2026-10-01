'use client';

// 【新增】管理后台通用竖向滑动条组件
// 背景：globals.css 中全局隐藏了原生滚动条（见 `*:not(.artplayer)::-webkit-scrollbar { display:none }`），
// 与「视频源列表 / 直播源列表 / 用户列表 / 用户组列表 / 分类列表」这类表格容器
// （max-h-* + overflow-y-auto）配套使用时，纵向溢出后用户既看不到滚动位置也无法拖动。
// 本组件在滚动容器右侧提供一条可拖动的竖向滑动条：支持拖动滑块、按住/点击轨道、
// 上下三角按钮步进、键盘上下键；内容未纵向溢出时自动隐藏。
//
// 【关键】不挤压显示内容框：
// 滑动条用绝对定位悬浮在滚动容器右边缘之上，完全不参与父容器（表格容器）的布局计算，
// 因此不会占用表格宽度。小屏 / 手机端表格本来就很窄，若把滑动条放进 flex 行内会明显压缩内容，
// 所以这里采用悬浮方案；同时容器本身 pointer-events-none，只有轨道与两个三角按钮可交互，
// 避免挡住表格右侧（操作列）的点击。
// 使用时需要把它放在一个 position: relative 且恰好包裹滚动容器的父元素内。

import { useCallback, useEffect, useRef, useState } from 'react';

interface VerticalScrollBarProps {
  /** 需要被控制的竖向滚动容器（如 max-h-* + overflow-y-auto 的表格容器） */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** 外层容器附加样式（可选） */
  className?: string;
  /** 提示文案（可选） */
  title?: string;
  /** 被控制滚动容器的 DOM id，用于无障碍 aria-controls（可选） */
  controlsId?: string;
}

// 滑块最小高度占轨道的比例，避免内容极长时滑块过小无法拖动
const MIN_THUMB_RATIO = 0.08;
// 单次滚动距离（px）：上下三角按钮点击与键盘上下键共用
const SCROLL_STEP = 80;

export default function VerticalScrollBar({
  scrollRef,
  className = '',
  title = '拖动滑块或点击轨道可上下滚动',
  controlsId,
}: VerticalScrollBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  // 滚动容器的度量信息
  const [metrics, setMetrics] = useState({
    scrollHeight: 0,
    clientHeight: 0,
    scrollTop: 0,
  });

  // 拖拽过程状态，使用 ref 存储避免拖动时触发额外渲染
  const dragStateRef = useRef<{
    pointerId: number;
    startY: number;
    startThumbTop: number;
    thumbRange: number;
    maxScroll: number;
  } | null>(null);

  const { scrollHeight, clientHeight, scrollTop } = metrics;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const scrollable = maxScroll > 1;

  // 同步滚动容器的尺寸与滚动位置
  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setMetrics((prev) => {
      const next = {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTop: el.scrollTop,
      };
      // 数值未变化时返回原对象，避免无意义的重渲染
      if (
        prev.scrollHeight === next.scrollHeight &&
        prev.clientHeight === next.clientHeight &&
        prev.scrollTop === next.scrollTop
      ) {
        return prev;
      }
      return next;
    });
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    sync();
    // 首帧后再测量一次，确保表格布局已完成
    const raf = requestAnimationFrame(sync);

    el.addEventListener('scroll', sync, { passive: true });

    // 容器自身尺寸变化（窗口缩放、小屏切换）
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(el);
    // 表格内容尺寸变化（行增删导致高度变化）
    const content = el.firstElementChild;
    if (content) resizeObserver.observe(content);

    // 表格行增删、状态文案更新后重新测量
    const mutationObserver = new MutationObserver(sync);
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', sync);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [scrollRef, sync]);

  // 滑块高度占轨道的比例（含最小高度保护）
  const thumbRatio = scrollable
    ? Math.max(clientHeight / scrollHeight, MIN_THUMB_RATIO)
    : 1;
  // 滑块在轨道内的偏移比例
  const thumbTopRatio =
    scrollable && maxScroll > 0
      ? Math.min(1, Math.max(0, scrollTop / maxScroll))
      : 0;

  // 上下三角按钮的可用状态（到达两端时置灰禁用）
  const canScrollUp = scrollTop > 1;
  const canScrollDown = scrollTop < maxScroll - 1;

  // 按固定步长滚动容器：上下三角按钮与键盘上下键共用
  const scrollByStep = useCallback(
    (direction: -1 | 1) => {
      const el = scrollRef.current;
      if (!el) return;
      // 直接读取真实尺寸，避免使用可能滞后的 state
      const limit = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(
        limit,
        Math.max(0, el.scrollTop + direction * SCROLL_STEP),
      );
    },
    [scrollRef],
  );

  // 按像素偏移量滚动容器
  const scrollToThumbTop = useCallback(
    (thumbTop: number, thumbRange: number, max: number) => {
      const el = scrollRef.current;
      if (!el || thumbRange <= 0) return;
      el.scrollTop = (thumbTop / thumbRange) * max;
    },
    [scrollRef],
  );

  // 开始拖动滑块
  const handleThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || !scrollable) return;
    e.preventDefault();
    e.stopPropagation();

    const trackHeight = track.getBoundingClientRect().height;
    const thumbHeight = trackHeight * thumbRatio;
    const thumbRange = Math.max(0, trackHeight - thumbHeight);

    dragStateRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startThumbTop: thumbTopRatio * thumbRange,
      thumbRange,
      maxScroll,
    };

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // 拖动滑块中
  const handleThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    e.preventDefault();

    const nextThumbTop = Math.min(
      state.thumbRange,
      Math.max(0, state.startThumbTop + (e.clientY - state.startY)),
    );
    scrollToThumbTop(nextThumbTop, state.thumbRange, state.maxScroll);
  };

  // 结束拖动
  const handleThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // 点击/按住轨道：滑块中心跳到点击位置，并支持继续拖动
  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || !scrollable) return;

    const rect = track.getBoundingClientRect();
    const trackHeight = rect.height;
    const thumbHeight = trackHeight * thumbRatio;
    const thumbRange = Math.max(0, trackHeight - thumbHeight);
    const clickY = e.clientY - rect.top;
    const nextThumbTop = Math.min(
      thumbRange,
      Math.max(0, clickY - thumbHeight / 2),
    );

    // 记录拖拽起点，按住轨道后可以继续拖动（与滑块共用同一套拖拽状态）
    dragStateRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startThumbTop: nextThumbTop,
      thumbRange,
      maxScroll,
    };
    e.currentTarget.setPointerCapture(e.pointerId);

    scrollToThumbTop(nextThumbTop, thumbRange, maxScroll);
  };

  // 键盘上下键滚动
  const handleTrackKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!scrollable) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      scrollByStep(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      scrollByStep(1);
    }
  };

  return (
    // 内容未纵向溢出时隐藏滑动条；absolute 悬浮在右边缘，不占用表格宽度
    <div
      className={`${scrollable ? 'flex' : 'hidden'} pointer-events-none absolute top-0 right-0 bottom-0 z-20 w-6 flex-col items-center gap-1 py-1 ${className}`}
    >
      {/* 向上小步滚动按钮（三角形） */}
      <button
        type='button'
        onClick={() => scrollByStep(-1)}
        disabled={!canScrollUp}
        aria-label='向上滚动'
        title='向上滚动'
        tabIndex={-1}
        className='pointer-events-auto shrink-0 flex items-center justify-center h-5 w-5 rounded-md bg-white/85 dark:bg-gray-800/85 text-gray-500 dark:text-gray-400 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-gray-200 dark:enabled:hover:bg-gray-700 enabled:hover:text-blue-600 dark:enabled:hover:text-blue-400'
      >
        <svg
          className='w-2.5 h-2.5'
          viewBox='0 0 12 12'
          fill='currentColor'
          aria-hidden='true'
        >
          <path d='M2 9 L6 3 L10 9 Z' />
        </svg>
      </button>

      {/* 轨道 */}
      <div
        ref={trackRef}
        role='scrollbar'
        aria-orientation='vertical'
        aria-valuemin={0}
        aria-valuemax={maxScroll}
        aria-valuenow={Math.round(scrollTop)}
        aria-controls={controlsId}
        aria-label='竖向滚动'
        tabIndex={0}
        title={title}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerCancel={handleThumbPointerUp}
        onKeyDown={handleTrackKeyDown}
        // w-4 + px-1 + bg-clip-content：交互热区 16px，视觉凹槽仍为 8px，
        // 手机端更容易按住拖动，同时不过多遮挡表格内容
        className='pointer-events-auto relative flex-1 min-h-0 w-4 px-1 rounded-full bg-gray-400/40 dark:bg-gray-500/40 bg-clip-content cursor-pointer select-none touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50'
      >
        {/* 滑块 */}
        <div
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={handleThumbPointerUp}
          onPointerCancel={handleThumbPointerUp}
          className='absolute left-1 w-2 rounded-full bg-gray-500 dark:bg-gray-400 hover:bg-blue-500 dark:hover:bg-blue-500 active:bg-blue-600 dark:active:bg-blue-600 cursor-grab active:cursor-grabbing transition-colors touch-none'
          style={{
            height: `${thumbRatio * 100}%`,
            top: `${thumbTopRatio * (1 - thumbRatio) * 100}%`,
          }}
        />
      </div>

      {/* 向下小步滚动按钮（三角形） */}
      <button
        type='button'
        onClick={() => scrollByStep(1)}
        disabled={!canScrollDown}
        aria-label='向下滚动'
        title='向下滚动'
        tabIndex={-1}
        className='pointer-events-auto shrink-0 flex items-center justify-center h-5 w-5 rounded-md bg-white/85 dark:bg-gray-800/85 text-gray-500 dark:text-gray-400 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-gray-200 dark:enabled:hover:bg-gray-700 enabled:hover:text-blue-600 dark:enabled:hover:text-blue-400'
      >
        <svg
          className='w-2.5 h-2.5'
          viewBox='0 0 12 12'
          fill='currentColor'
          aria-hidden='true'
        >
          <path d='M2 3 L6 9 L10 3 Z' />
        </svg>
      </button>
    </div>
  );
}
