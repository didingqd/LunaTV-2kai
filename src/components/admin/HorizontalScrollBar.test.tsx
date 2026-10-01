import { fireEvent, render } from '@testing-library/react';
import type { RefObject } from 'react';

import HorizontalScrollBar from './HorizontalScrollBar';

// 【新增】jsdom 缺失的浏览器 API 桩实现
beforeAll(() => {
  // 组件内部使用 ResizeObserver 监听尺寸变化
  if (!('ResizeObserver' in global)) {
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // jsdom 未实现 PointerEvent，用 MouseEvent 兜底以便测试 clientX / pointerId
  if (!('PointerEvent' in global)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    (global as unknown as { PointerEvent: unknown }).PointerEvent =
      PointerEventPolyfill;
  }
  // jsdom 未实现指针捕获，桩掉避免拖动时报错
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  HTMLElement.prototype.hasPointerCapture = jest.fn(() => false);
});

// 构造一个可控的滚动容器：jsdom 无布局，需手动定义尺寸与滚动位置
const makeScrollContainer = (scrollWidth: number, clientWidth: number) => {
  const el = document.createElement('div');
  let scrollLeft = 0;
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth });
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = Math.max(0, Math.min(value, scrollWidth - clientWidth));
      // 模拟浏览器：滚动位置变化后会派发 scroll 事件
      el.dispatchEvent(new Event('scroll'));
    },
  });
  return el;
};

// 渲染滑动条并返回关键节点
const renderBar = (scrollWidth: number, clientWidth: number) => {
  const container = makeScrollContainer(scrollWidth, clientWidth);
  const scrollRef = { current: container } as RefObject<HTMLDivElement>;
  const { container: dom } = render(
    <HorizontalScrollBar scrollRef={scrollRef} />,
  );

  const track = dom.querySelector('[role="scrollbar"]') as HTMLElement;
  const thumb = track.firstElementChild as HTMLElement;
  const wrapper = track.parentElement as HTMLElement;
  const prevButton = wrapper.querySelector(
    '[aria-label="向左滚动"]',
  ) as HTMLButtonElement;
  const nextButton = wrapper.querySelector(
    '[aria-label="向右滚动"]',
  ) as HTMLButtonElement;

  // 轨道宽度固定为 200，便于计算拖拽比例
  jest
    .spyOn(track, 'getBoundingClientRect')
    .mockReturnValue({ left: 0, width: 200 } as DOMRect);

  return { container, track, thumb, wrapper, prevButton, nextButton };
};

describe('HorizontalScrollBar', () => {
  it('内容溢出时显示滑动条，并按滚动比例计算滑块尺寸', () => {
    const { thumb, wrapper } = renderBar(1000, 250);

    // 可见（非 hidden）
    expect(wrapper.className).not.toContain('hidden');
    // 滑块宽度 = clientWidth / scrollWidth = 25%
    expect(thumb.style.width).toBe('25%');
    // 初始位置在轨道最左侧
    expect(thumb.style.left).toBe('0%');
  });

  it('内容未溢出时隐藏滑动条', () => {
    const { wrapper, track } = renderBar(400, 400);

    expect(wrapper.className).toContain('hidden');
    expect(track).toBeTruthy();
  });

  it('拖动滑块可左右滚动表格容器', () => {
    const { container, thumb } = renderBar(1000, 250);

    // 轨道 200px，滑块 50px，可拖动范围 150px，最大滚动 750px
    fireEvent.pointerDown(thumb, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(thumb, { clientX: 75, pointerId: 1 });

    expect(container.scrollLeft).toBe(375); // 75 / 150 * 750
    // 同步更新滑块位置
    expect(thumb.style.left).toBe('37.5%'); // 0.5 * (1 - 0.25) * 100

    // 继续拖到最右端时滚动到最大值
    fireEvent.pointerMove(thumb, { clientX: 200, pointerId: 1 });
    expect(container.scrollLeft).toBe(750);

    fireEvent.pointerUp(thumb, { clientX: 200, pointerId: 1 });
  });

  it('点击轨道可跳转到对应位置，并支持继续拖动', () => {
    const { container, track } = renderBar(1000, 250);

    // 点击 150px 处：滑块中心对齐点击位置 => 150 - 25 = 125px
    fireEvent.pointerDown(track, { clientX: 150, pointerId: 1 });
    expect(container.scrollLeft).toBe(625); // 125 / 150 * 750

    // 按住不放继续右移 25px，滚动到最右端
    fireEvent.pointerMove(track, { clientX: 175, pointerId: 1 });
    expect(container.scrollLeft).toBe(750);

    fireEvent.pointerUp(track, { clientX: 175, pointerId: 1 });
  });

  it('支持键盘左右键滚动', () => {
    const { container, track } = renderBar(1000, 250);

    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(container.scrollLeft).toBe(80);

    fireEvent.keyDown(track, { key: 'ArrowLeft' });
    expect(container.scrollLeft).toBe(0);
  });

  it('点击左右三角按钮可按步长滚动，并在两端禁用', () => {
    const { container, prevButton, nextButton } = renderBar(1000, 250);

    // 初始位于最左端：左三角禁用，右三角可用
    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    expect(container.scrollLeft).toBe(80); // 单步 80px

    fireEvent.click(nextButton);
    expect(container.scrollLeft).toBe(160);

    // 左三角可以逐步回退
    fireEvent.click(prevButton);
    expect(container.scrollLeft).toBe(80);

    fireEvent.click(prevButton);
    expect(container.scrollLeft).toBe(0);
    expect(prevButton).toBeDisabled();
  });

  it('右三角滚动到末端后自动禁用', () => {
    const { container, nextButton } = renderBar(1000, 250);

    // 连续点击直到最大滚动位置（750px）
    for (let i = 0; i < 12; i += 1) {
      fireEvent.click(nextButton);
    }

    expect(container.scrollLeft).toBe(750);
    expect(nextButton).toBeDisabled();
  });

  it('不再渲染进度百分比文案', () => {
    const { wrapper } = renderBar(1000, 250);

    expect(wrapper.textContent).toBe('');
  });

  it('轨道视觉粗细为 8px，与竖向滑动条保持一致', () => {
    const { track, thumb } = renderBar(1000, 250);

    // 轨道元素 16px 高，去掉上下各 4px 内边距后背景只绘制 8px（bg-clip-content）
    expect(track.className).toContain('h-4');
    expect(track.className).toContain('py-1');
    expect(track.className).toContain('bg-clip-content');
    // 滑块同样是 8px 高，居中在 16px 的交互热区内
    expect(thumb.className).toContain('h-2');
    expect(thumb.className).toContain('top-1');
  });
});
