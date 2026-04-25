// 修改点：新增快进快退布局合并映射测试（TDD 红灯阶段）
import {
  clampSeekTarget,
  readSeekConfigFromStorage,
  sanitizeSeekHandMode,
  sanitizeSeekSeconds,
  toSeekLayoutMode,
  fromSeekLayoutMode,
  sanitizeSeekLayoutMode,
} from '@/lib/player-seek';

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

  // 修改点：新增布局四态映射测试，覆盖“关闭/双手/左手/右手”与状态映射
  test('SeekLayout toSeekLayoutMode: show=false 时总是 off', () => {
    expect(toSeekLayoutMode(false, 'both')).toBe('off');
    expect(toSeekLayoutMode(false, 'left')).toBe('off');
    expect(toSeekLayoutMode(false, 'right')).toBe('off');
  });

  test('SeekLayout toSeekLayoutMode: show=true 时返回 handMode', () => {
    expect(toSeekLayoutMode(true, 'both')).toBe('both');
    expect(toSeekLayoutMode(true, 'left')).toBe('left');
    expect(toSeekLayoutMode(true, 'right')).toBe('right');
  });

  test('SeekLayout fromSeekLayoutMode: 选择 off 仅关闭显示，不改 handMode', () => {
    expect(fromSeekLayoutMode('off', 'left')).toEqual({ showControls: false, handMode: 'left' });
    expect(fromSeekLayoutMode('off', 'right')).toEqual({ showControls: false, handMode: 'right' });
  });

  test('SeekLayout fromSeekLayoutMode: 选择 both/left/right 时开启显示并更新 handMode', () => {
    expect(fromSeekLayoutMode('both', 'left')).toEqual({ showControls: true, handMode: 'both' });
    expect(fromSeekLayoutMode('left', 'both')).toEqual({ showControls: true, handMode: 'left' });
    expect(fromSeekLayoutMode('right', 'both')).toEqual({ showControls: true, handMode: 'right' });
  });

  test('SeekLayout sanitizeSeekLayoutMode: 非法值回退 off', () => {
    expect(sanitizeSeekLayoutMode('off')).toBe('off');
    expect(sanitizeSeekLayoutMode('left')).toBe('left');
    expect(sanitizeSeekLayoutMode('xx')).toBe('off');
    expect(sanitizeSeekLayoutMode(undefined)).toBe('off');
  });

  // 修改点：保留原有读取持久化配置的回归测试，确保功能不变
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

