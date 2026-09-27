import { fireEvent, render, screen } from '@testing-library/react';

import { SearchResult } from '@/lib/types';

import EpisodeSelector from './EpisodeSelector';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/lib/utils', () => ({
  getVideoResolutionFromM3u8: jest.fn().mockResolvedValue({
    quality: '',
    loadSpeed: '',
    pingTime: 0,
    playable: false,
    testedAt: Date.now(),
  }),
  processImageUrl: (url: string) => url,
}));

const makeSource = (
  source: string,
  title: string,
  episodeCount: number,
): SearchResult =>
  ({
    source,
    id: `${source}-id`,
    title,
    poster: '',
    source_name: source,
    episodes: Array.from(
      { length: episodeCount },
      (_, i) => `https://example.com/${source}/${i}.m3u8`,
    ),
  }) as unknown as SearchResult;

const SOURCES = [
  makeSource('b', 'B源', 5),
  makeSource('a', 'A源', 12),
  makeSource('d', 'D源', 12),
  makeSource('c', 'C源', 3),
];

const btn = (label: string) =>
  screen.getByText(label).closest('button') as HTMLButtonElement;
const iconClass = (label: string) =>
  btn(label).querySelector('svg')?.getAttribute('class') ?? null;
const currentOrder = () =>
  screen
    .getAllByRole('heading', { level: 3 })
    .map((el) => el.textContent?.trim());

describe('EpisodeSelector 换源排序', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('enableOptimization', 'false');
    render(
      <EpisodeSelector
        totalEpisodes={1}
        episodes_titles={[]}
        availableSources={SOURCES}
        currentSource='zzz'
        currentId='none'
      />,
    );
  });

  it('箭头朝向与右侧字符在正/倒序切换时同时变化', () => {
    // 原始：下标递增方向
    expect(iconClass('原始')).toContain('lucide-arrow-down');
    fireEvent.click(btn('原始'));
    expect(iconClass('原始')).toContain('lucide-arrow-up');

    // 速度：正序快的在前（宽条在上，箭头朝上）
    fireEvent.click(btn('速度'));
    expect(iconClass('速度')).toContain('lucide-arrow-up-wide-narrow');
    fireEvent.click(btn('速度'));
    expect(iconClass('速度')).toContain('lucide-arrow-down-narrow-wide');

    // 名称：正序 A→Z（Z 在下，箭头朝下）
    fireEvent.click(btn('名称'));
    expect(iconClass('名称')).toContain('lucide-arrow-down-a-z');
    fireEvent.click(btn('名称'));
    expect(iconClass('名称')).toContain('lucide-arrow-up-z-a');

    // 集数：正序多的在前（1 在上，箭头朝上）
    fireEvent.click(btn('集数'));
    expect(iconClass('集数')).toContain('lucide-arrow-up-1-0');
    fireEvent.click(btn('集数'));
    expect(iconClass('集数')).toContain('lucide-arrow-down-0-1');
  });

  it('动画类、尺寸、方向配色保持不变', () => {
    expect(iconClass('原始')).toContain('sort-direction-flip');
    expect(iconClass('原始')).toContain('w-4');
    expect(iconClass('原始')).toContain('text-emerald-500');
    fireEvent.click(btn('原始'));
    expect(iconClass('原始')).toContain('sort-direction-flip');
    expect(iconClass('原始')).toContain('text-amber-500');
  });

  it('排序结果未受影响', () => {
    expect(currentOrder()).toEqual(['B源', 'A源', 'D源', 'C源']);
    fireEvent.click(btn('集数'));
    expect(currentOrder()).toEqual(['A源', 'D源', 'B源', 'C源']);
    fireEvent.click(btn('集数'));
    expect(currentOrder()).toEqual(['C源', 'B源', 'A源', 'D源']);
    fireEvent.click(btn('名称'));
    expect(currentOrder()).toEqual(['A源', 'B源', 'C源', 'D源']);
    fireEvent.click(btn('名称'));
    expect(currentOrder()).toEqual(['D源', 'C源', 'B源', 'A源']);
  });
});
