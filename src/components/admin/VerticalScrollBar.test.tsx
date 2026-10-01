import { fireEvent, render } from '@testing-library/react';
import type { RefObject } from 'react';

import VerticalScrollBar from './VerticalScrollBar';

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
  // jsdom 未实现 PointerEvent，用 MouseEvent 兜底以便测试 clientY / pointerId
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

// 构造一个可控的竖向滚动容器：jsdom 无布局，需手动定义尺寸与滚动位置
const makeScrollContainer = (scrollHeight: number, clientHeight: number) => {
  const el = document.createElement('div');
  let scrollTop = 0;
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
      // 模拟浏览器：滚动位置变化后会派发 scroll 事件
      el.dispatchEvent(new Event('scroll'));
    },
  });
  return el;
};

// 渲染滑动条并返回关键节点
const renderBar = (scrollHeight: number, clientHeight: number) => {
  const container = makeScrollContainer(scrollHeight, clientHeight);
  const scrollRef = { current: container } as RefObject<HTMLDivElement>;
  const { container: dom } = render(<VerticalScrollBar scrollRef={scrollRef} />);

  const track = dom.querySelector('[role="scrollbar"]') as HTMLElement;
  const thumb = track.firstElementChild as HTMLElement;
  const wrapper = track.parentElement as HTMLElement;
  const upButton = wrapper.querySelector(
    '[aria-label="向上滚动"]',
  ) as HTMLButtonElement;
  const downButton = wrapper.querySelector(
    '[aria-label="向下滚动"]',
  ) as HTMLButtonElement;

  // 轨道高度固定为 200，便于计算拖拽比例
  jest
    .spyOn(track, 'getBoundingClientRect')
    .mockReturnValue({ top: 0, height: 200 } as DOMRect);

  return { container, track, thumb, wrapper, upButton, downButton };
};

describe('VerticalScrollBar', () => {
  it('内容溢出时显示滑动条，并按滚动比例计算滑块尺寸', () => {
    const { thumb, wrapper } = renderBar(1000, 250);

    // 可见（非 hidden）
    expect(wrapper.className).not.toContain('hidden');
    // 滑块高度 = clientHeight / scrollHeight = 25%
    expect(thumb.style.height).toBe('25%');
    // 初始位置在轨道最上方
    expect(thumb.style.top).toBe('0%');
  });

  it('滑动条为绝对定位悬浮层，不占用表格容器的布局空间', () => {
    const { wrapper } = renderBar(1000, 250);

    // absolute + 不参与指针事件，保证既不会挤压内容宽度也不会挡住表格点击
    expect(wrapper.className).toContain('absolute');
    expect(wrapper.className).toContain('right-0');
    expect(wrapper.className).toContain('pointer-events-none');
  });

  it('内容未溢出时隐藏滑动条', () => {
    const { wrapper, track } = renderBar(400, 400);

    expect(wrapper.className).toContain('hidden');
    expect(track).toBeTruthy();
  });

  it('拖动滑块可上下滚动表格容器', () => {
    const { container, thumb } = renderBar(1000, 250);

    // 轨道 200px，滑块 50px，可拖动范围 150px，最大滚动 750px
    fireEvent.pointerDown(thumb, { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(thumb, { clientY: 75, pointerId: 1 });

    expect(container.scrollTop).toBe(375); // 75 / 150 * 750
    // 同步更新滑块位置
    expect(thumb.style.top).toBe('37.5%'); // 0.5 * (1 - 0.25) * 100

    // 继续拖到最下方时滚动到最大值
    fireEvent.pointerMove(thumb, { clientY: 200, pointerId: 1 });
    expect(container.scrollTop).toBe(750);

    fireEvent.pointerUp(thumb, { clientY: 200, pointerId: 1 });
  });

  it('点击轨道可跳转到对应位置，并支持继续拖动', () => {
    const { container, track } = renderBar(1000, 250);

    // 点击 150px 处：滑块中心对齐点击位置 => 150 - 25 = 125px
    fireEvent.pointerDown(track, { clientY: 150, pointerId: 1 });
    expect(container.scrollTop).toBe(625); // 125 / 150 * 750

    // 按住不放继续下移 25px，滚动到最下方
    fireEvent.pointerMove(track, { clientY: 175, pointerId: 1 });
    expect(container.scrollTop).toBe(750);

    fireEvent.pointerUp(track, { clientY: 175, pointerId: 1 });
  });

  it('支持键盘上下键滚动', () => {
    const { container, track } = renderBar(1000, 250);

    fireEvent.keyDown(track, { key: 'ArrowDown' });
    expect(container.scrollTop).toBe(80);

    fireEvent.keyDown(track, { key: 'ArrowUp' });
    expect(container.scrollTop).toBe(0);
  });

  it('点击上下三角按钮可按步长滚动，并在两端禁用', () => {
    const { container, upButton, downButton } = renderBar(1000, 250);

    // 初始位于最上方：上三角禁用，下三角可用
    expect(upButton).toBeDisabled();
    expect(downButton).toBeEnabled();

    fireEvent.click(downButton);
    expect(container.scrollTop).toBe(80); // 单步 80px

    fireEvent.click(downButton);
    expect(container.scrollTop).toBe(160);

    // 上三角可以逐步回退
    fireEvent.click(upButton);
    expect(container.scrollTop).toBe(80);

    fireEvent.click(upButton);
    expect(container.scrollTop).toBe(0);
    expect(upButton).toBeDisabled();
  });

  it('下三角滚动到末端后自动禁用', () => {
    const { container, downButton } = renderBar(1000, 250);

    // 连续点击直到最大滚动位置（750px）
    for (let i = 0; i < 12; i += 1) {
      fireEvent.click(downButton);
    }

    expect(container.scrollTop).toBe(750);
    expect(downButton).toBeDisabled();
  });

  it('无障碍属性标明竖向滚动方向与滚动位置', () => {
    const { track } = renderBar(1000, 250);

    expect(track.getAttribute('aria-orientation')).toBe('vertical');
    expect(track.getAttribute('aria-valuemax')).toBe('750');
    expect(track.getAttribute('aria-valuenow')).toBe('0');
  });
});
