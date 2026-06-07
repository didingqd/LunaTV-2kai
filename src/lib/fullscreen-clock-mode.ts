export type FullscreenClockMode = 'off' | 'always' | 'controls';

// 修改点：统一播放器右上角实时时间显示模式的本地设置 key，供设置面板和播放器共用。
export const FULLSCREEN_CLOCK_MODE_KEY = 'moontv_fullscreen_clock_mode';
export const FULLSCREEN_CLOCK_MODE_CHANGE_EVENT =
  'moontv_fullscreen_clock_mode_change';

export const FULLSCREEN_CLOCK_MODE_OPTIONS = [
  {
    value: 'off',
    label: '关闭',
    description: '不显示播放器右上角实时时间',
  },
  {
    value: 'always',
    label: '常显',
    description: '全屏时始终显示右上角实时时间',
  },
  {
    value: 'controls',
    label: '随控制栏',
    description: '控制栏出现时显示，隐藏时一并淡出',
  },
] as const satisfies Array<{
  value: FullscreenClockMode;
  label: string;
  description: string;
}>;

export function sanitizeFullscreenClockMode(
  value: unknown,
): FullscreenClockMode {
  if (value === 'off' || value === 'always' || value === 'controls') {
    return value;
  }
  // 修改点：无有效本地设置时，默认跟随播放器控制栏显示/隐藏。
  return 'controls';
}

export function loadFullscreenClockMode(): FullscreenClockMode {
  if (typeof window === 'undefined') return 'controls';
  return sanitizeFullscreenClockMode(
    localStorage.getItem(FULLSCREEN_CLOCK_MODE_KEY),
  );
}

export function saveFullscreenClockMode(mode: FullscreenClockMode) {
  if (typeof window === 'undefined') return;
  const nextMode = sanitizeFullscreenClockMode(mode);
  localStorage.setItem(FULLSCREEN_CLOCK_MODE_KEY, nextMode);
  window.dispatchEvent(
    new CustomEvent(FULLSCREEN_CLOCK_MODE_CHANGE_EVENT, {
      detail: nextMode,
    }),
  );
}
