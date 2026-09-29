'use client';

// 【新增】管理后台通用横向滑动条组件
// 背景：globals.css 中全局隐藏了所有原生滚动条（见 `*:not(.artplayer)::-webkit-scrollbar { display:none }`），
// 因此在窄屏下查看「视频源列表」这类宽表格时，用户无法通过肉眼或拖拽感知横向溢出内容。
// 本组件在滚动容器下方渲染一个可拖动的滑动条（同时支持点击轨道跳转、键盘左右键），
// 用于左右拖动以展示表格的完整列；内容未溢出时自动隐藏。

import { useCallback, useEffect, useRef, useState } from 'react';

interface HorizontalScrollBarProps {
  /** 需要被控制的横向滚动容器（如包裹 table 的 div） */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** 外层容器附加样式（可选） */
  className?: string;
  /** 提示文案（可选） */
  title?: string;
  /** 被控制滚动容器的 DOM id，用于无障碍 aria-controls（可选） */
  controlsId?: string;
}

// 滑块最小宽度占轨道的比例，避免内容极宽时滑块过小无法拖动
const MIN_THUMB_RATIO = 0.08;
// 【修改】单次滚动距离（px）：左右三角按钮点击与键盘左右键共用
const SCROLL_STEP = 80;

export default function HorizontalScrollBar({
  scrollRef,
  className = '',
  title = '拖动滑块或点击轨道可左右滚动',
  controlsId,
}: HorizontalScrollBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  // 滚动容器的度量信息
  const [metrics, setMetrics] = useState({
    scrollWidth: 0,
    clientWidth: 0,
    scrollLeft: 0,
  });

  // 拖拽过程状态，使用 ref 存储避免拖动时触发额外渲染
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startThumbLeft: number;
    thumbRange: number;
    maxScroll: number;
  } | null>(null);

  const { scrollWidth, clientWidth, scrollLeft } = metrics;
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const scrollable = maxScroll > 1;

  // 同步滚动容器的尺寸与滚动位置
  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setMetrics((prev) => {
      const next = {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollLeft: el.scrollLeft,
      };
      // 数值未变化时返回原对象，避免无意义的重渲染
      if (
        prev.scrollWidth === next.scrollWidth &&
        prev.clientWidth === next.clientWidth &&
        prev.scrollLeft === next.scrollLeft
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

    // 容器自身尺寸变化（窗口缩放）
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(el);
    // 表格内容尺寸变化（列宽变化）
    const content = el.firstElementChild;
    if (content) resizeObserver.observe(content);

    // 表格行/列增删、状态文案更新后重新测量
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

  // 滑块宽度占轨道的比例（含最小宽度保护）
  const thumbRatio = scrollable
    ? Math.max(clientWidth / scrollWidth, MIN_THUMB_RATIO)
    : 1;
  // 滑块在轨道内的偏移比例
  const thumbLeftRatio =
    scrollable && maxScroll > 0
      ? Math.min(1, Math.max(0, scrollLeft / maxScroll))
      : 0;

  // 【新增】左右三角按钮的可用状态（到达两端时置灰禁用）
  const canScrollLeft = scrollLeft > 1;
  const canScrollRight = scrollLeft < maxScroll - 1;

  // 【新增】按固定步长滚动容器：左右三角按钮与键盘左右键共用
  const scrollByStep = useCallback(
    (direction: -1 | 1) => {
      const el = scrollRef.current;
      if (!el) return;
      // 直接读取真实尺寸，避免使用可能滞后的 state
      const limit = Math.max(0, el.scrollWidth - el.clientWidth);
      el.scrollLeft = Math.min(
        limit,
        Math.max(0, el.scrollLeft + direction * SCROLL_STEP),
      );
    },
    [scrollRef],
  );

  // 按像素偏移量滚动容器
  const scrollToThumbLeft = useCallback(
    (thumbLeft: number, thumbRange: number, max: number) => {
      const el = scrollRef.current;
      if (!el || thumbRange <= 0) return;
      el.scrollLeft = (thumbLeft / thumbRange) * max;
    },
    [scrollRef],
  );

  // 开始拖动滑块
  const handleThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || !scrollable) return;
    e.preventDefault();
    e.stopPropagation();

    const trackWidth = track.getBoundingClientRect().width;
    const thumbWidth = trackWidth * thumbRatio;
    const thumbRange = Math.max(0, trackWidth - thumbWidth);

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startThumbLeft: thumbLeftRatio * thumbRange,
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

    const nextThumbLeft = Math.min(
      state.thumbRange,
      Math.max(0, state.startThumbLeft + (e.clientX - state.startX)),
    );
    scrollToThumbLeft(nextThumbLeft, state.thumbRange, state.maxScroll);
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
    const trackWidth = rect.width;
    const thumbWidth = trackWidth * thumbRatio;
    const thumbRange = Math.max(0, trackWidth - thumbWidth);
    const clickX = e.clientX - rect.left;
    const nextThumbLeft = Math.min(
      thumbRange,
      Math.max(0, clickX - thumbWidth / 2),
    );

    // 记录拖拽起点，按住轨道后可以继续拖动（与滑块共用同一套拖拽状态）
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startThumbLeft: nextThumbLeft,
      thumbRange,
      maxScroll,
    };
    e.currentTarget.setPointerCapture(e.pointerId);

    scrollToThumbLeft(nextThumbLeft, thumbRange, maxScroll);
  };

  // 键盘左右键滚动
  const handleTrackKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!scrollable) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      scrollByStep(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      scrollByStep(1);
    }
  };

  return (
    // 内容未溢出时隐藏滑动条，避免占用无效空间
    <div
      className={`${scrollable ? 'flex' : 'hidden'} items-center gap-2 mt-2 px-1 ${className}`}
    >
      {/* 【新增】向左小步滚动按钮（三角形） */}
      <button
        type='button'
        onClick={() => scrollByStep(-1)}
        disabled={!canScrollLeft}
        aria-label='向左滚动'
        title='向左滚动'
        className='shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-gray-500 dark:text-gray-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-gray-200 dark:enabled:hover:bg-gray-700 enabled:hover:text-blue-600 dark:enabled:hover:text-blue-400'
      >
        <svg
          className='w-3 h-3'
          viewBox='0 0 12 12'
          fill='currentColor'
          aria-hidden='true'
        >
          <path d='M9 2 L3 6 L9 10 Z' />
        </svg>
      </button>

      {/* 轨道 */}
      <div
        ref={trackRef}
        role='scrollbar'
        aria-orientation='horizontal'
        aria-valuemin={0}
        aria-valuemax={maxScroll}
        aria-valuenow={Math.round(scrollLeft)}
        aria-controls={controlsId}
        aria-label='横向滚动'
        tabIndex={0}
        title={title}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerCancel={handleThumbPointerUp}
        onKeyDown={handleTrackKeyDown}
        className='relative flex-1 h-3 rounded-full bg-gray-200 dark:bg-gray-700 cursor-pointer select-none touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50'
      >
        {/* 滑块 */}
        <div
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={handleThumbPointerUp}
          onPointerCancel={handleThumbPointerUp}
          className='absolute top-0 h-full rounded-full bg-gray-400 dark:bg-gray-500 hover:bg-blue-500 dark:hover:bg-blue-500 active:bg-blue-600 dark:active:bg-blue-600 cursor-grab active:cursor-grabbing transition-colors touch-none'
          style={{
            width: `${thumbRatio * 100}%`,
            left: `${thumbLeftRatio * (1 - thumbRatio) * 100}%`,
          }}
        />
      </div>

      {/* 【新增】向右小步滚动按钮（三角形）；原进度百分比已按需求移除 */}
      <button
        type='button'
        onClick={() => scrollByStep(1)}
        disabled={!canScrollRight}
        aria-label='向右滚动'
        title='向右滚动'
        className='shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-gray-500 dark:text-gray-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-gray-200 dark:enabled:hover:bg-gray-700 enabled:hover:text-blue-600 dark:enabled:hover:text-blue-400'
      >
        <svg
          className='w-3 h-3'
          viewBox='0 0 12 12'
          fill='currentColor'
          aria-hidden='true'
        >
          <path d='M3 2 L9 6 L3 10 Z' />
        </svg>
      </button>
    </div>
  );
}
