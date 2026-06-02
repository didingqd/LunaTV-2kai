import { UpdateStatus } from '@/lib/version_check';
import {
  getUserMenuIndicatorColor,
  getSeekKeyboardDelta,
} from '@/lib/user-menu-indicator';

describe('getSeekKeyboardDelta', () => {
  it('在关闭快进快退布局时仍允许左方向键快退', () => {
    expect(
      getSeekKeyboardDelta({
        altKey: false,
        key: 'ArrowLeft',
        seekSeconds: 10,
      })
    ).toBe(-10);
  });

  it('在关闭快进快退布局时仍允许右方向键快进', () => {
    expect(
      getSeekKeyboardDelta({
        altKey: false,
        key: 'ArrowRight',
        seekSeconds: 15,
      })
    ).toBe(15);
  });

  it('按住 Alt 时不占用切集快捷键', () => {
    expect(
      getSeekKeyboardDelta({
        altKey: true,
        key: 'ArrowLeft',
        seekSeconds: 10,
      })
    ).toBeNull();
  });
});

describe('getUserMenuIndicatorColor', () => {
  it('有版本更新时始终显示黄点', () => {
    expect(
      getUserMenuIndicatorColor({
        hasActualUpdates: true,
        updateStatus: UpdateStatus.HAS_UPDATE,
      })
    ).toBe('yellow');
  });

  it('仅有更新提醒时显示红点', () => {
    expect(
      getUserMenuIndicatorColor({
        hasActualUpdates: true,
        updateStatus: UpdateStatus.NO_UPDATE,
      })
    ).toBe('red');
  });

  it('没有版本更新也没有更新提醒时不显示提示点', () => {
    expect(
      getUserMenuIndicatorColor({
        hasActualUpdates: false,
        updateStatus: UpdateStatus.NO_UPDATE,
      })
    ).toBeNull();
  });
});
