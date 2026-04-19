// 修改点：新增快进快退工具函数测试，先以 TDD 方式覆盖秒数清洗与时间钳制
import { clampSeekTarget, readSeekConfigFromStorage, sanitizeSeekHandMode, sanitizeSeekSeconds } from '@/lib/player-seek';

describe('player-seek utils', () => {
  test('sanitizeSeekSeconds: 非法值回退默认值', () => {
    expect(sanitizeSeekSeconds(undefined, 10)).toBe(10);
    expect(sanitizeSeekSeconds(NaN, 10)).toBe(10);
    expect(sanitizeSeekSeconds(-3, 10)).toBe(10);
    expect(sanitizeSeekSeconds(0, 10)).toBe(10);
  });

  test('sanitizeSeekSeconds: 小数与超大值会被规范化', () => {
    expect(sanitizeSeekSeconds(5.7, 10)).toBe(6);
    expect(sanitizeSeekSeconds(9999, 10)).toBe(600);
  });

  test('clampSeekTarget: 正常区间、下限、上限', () => {
    expect(clampSeekTarget(30, -10, 120)).toBe(20);
    expect(clampSeekTarget(3, -10, 120)).toBe(0);
    expect(clampSeekTarget(118, 10, 120)).toBe(120);
  });

  test('readSeekConfigFromStorage: 默认值为 10/true/both', () => {
    // 修改点：新增单手模式字段后，验证默认配置读取仍兼容旧行为
    const storage = new Map<string, string>();
    const getItem = (k: string) => storage.get(k) ?? null;
    expect(readSeekConfigFromStorage(getItem)).toEqual({
      seekSeconds: 10,
      showControls: true,
      handMode: 'both',
    });
  });

  // 修改点：覆盖单手模式合法值、非法值与未知值清洗
  test('sanitizeSeekHandMode: 合法值直通，非法值回退默认', () => {
    expect(sanitizeSeekHandMode('both')).toBe('both');
    expect(sanitizeSeekHandMode('left')).toBe('left');
    expect(sanitizeSeekHandMode('right')).toBe('right');
    expect(sanitizeSeekHandMode(undefined)).toBe('both');
    expect(sanitizeSeekHandMode(null)).toBe('both');
    expect(sanitizeSeekHandMode('unknown')).toBe('both');
    expect(sanitizeSeekHandMode('LEFT')).toBe('both');
    expect(sanitizeSeekHandMode(123)).toBe('both');
    expect(sanitizeSeekHandMode('left', 'right')).toBe('left');
    expect(sanitizeSeekHandMode('xx', 'right')).toBe('right');
  });

  // 修改点：验证 readSeekConfigFromStorage 读取自定义单手模式与其他持久化值
  test('readSeekConfigFromStorage: 读取自定义单手模式', () => {
    const storage = new Map<string, string>([
      ['play_seek_hand_mode', 'left'],
      ['play_show_seek_controls', 'false'],
      ['play_seek_seconds', '15'],
    ]);
    const getItem = (k: string) => storage.get(k) ?? null;
    expect(readSeekConfigFromStorage(getItem)).toEqual({
      seekSeconds: 15,
      showControls: false,
      handMode: 'left',
    });
  });
});

