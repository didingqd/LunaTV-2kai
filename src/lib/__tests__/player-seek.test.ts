// 修改点：新增快进快退工具函数测试，先以 TDD 方式覆盖秒数清洗与时间钳制
import { clampSeekTarget, readSeekConfigFromStorage, sanitizeSeekSeconds } from '@/lib/player-seek';

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

  test('readSeekConfigFromStorage: 默认值为 10/10/true', () => {
    // 修改点：新增本地配置默认值读取测试
    const storage = new Map<string, string>();
    const getItem = (k: string) => storage.get(k) ?? null;
    expect(readSeekConfigFromStorage(getItem)).toEqual({
      backward: 10,
      forward: 10,
      showControls: true,
    });
  });
});

