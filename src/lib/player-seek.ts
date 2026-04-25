// 修改点：新增播放器快进快退配置读取与时间计算工具函数
export function sanitizeSeekSeconds(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(600, Math.round(n));
}

// 修改点：新增统一跳转目标时间钳制逻辑
export function clampSeekTarget(currentTime: number, deltaSeconds: number, duration: number): number {
  const safeCurrent = Number.isFinite(currentTime) ? currentTime : 0;
  const safeDelta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const next = safeCurrent + safeDelta;
  if (next < 0) return 0;
  if (next > safeDuration) return safeDuration;
  return next;
}

// 修改点：新增快进快退按钮单手布局枚举，支持双手/左手/右手三种模式
export type SeekHandMode = 'both' | 'left' | 'right';

// 修改点：新增设置面板布局四态，合并“显示按钮”与“布局选择”入口
export type SeekLayoutMode = 'off' | 'both' | 'left' | 'right';

// 修改点：新增布局四态值清洗，非法值回退为 off
export function sanitizeSeekLayoutMode(value: unknown, fallback: SeekLayoutMode = 'off'): SeekLayoutMode {
  if (value === 'off' || value === 'both' || value === 'left' || value === 'right') return value;
  return fallback;
}

// 修改点：由现有状态映射为设置面板展示值
export function toSeekLayoutMode(showControls: boolean, handMode: SeekHandMode): SeekLayoutMode {
  if (!showControls) return 'off';
  return sanitizeSeekHandMode(handMode, 'both');
}

// 修改点：由设置面板选择值反推现有状态，保持原有功能与持久化结构不变
export function fromSeekLayoutMode(
  layoutMode: SeekLayoutMode,
  currentHandMode: SeekHandMode,
): { showControls: boolean; handMode: SeekHandMode } {
  const mode = sanitizeSeekLayoutMode(layoutMode, 'off');
  if (mode === 'off') {
    return { showControls: false, handMode: sanitizeSeekHandMode(currentHandMode, 'both') };
  }
  return { showControls: true, handMode: sanitizeSeekHandMode(mode, 'both') };
}

// 修改点：新增单手模式值清洗，非法值回退为双手（默认），避免读到脏数据时 UI 错乱
export function sanitizeSeekHandMode(value: unknown, fallback: SeekHandMode = 'both'): SeekHandMode {
  if (value === 'both' || value === 'left' || value === 'right') return value;
  return fallback;
}

// 修改点：快进快退时长合并为统一配置，兼容旧键值读取，并扩展单手布局读取
export function readSeekConfigFromStorage(getItem: (key: string) => string | null) {
  const unified = getItem('play_seek_seconds');
  const legacyBackward = getItem('play_seek_backward_seconds');
  const legacyForward = getItem('play_seek_forward_seconds');
  const seekSeconds = sanitizeSeekSeconds(unified ?? legacyForward ?? legacyBackward, 10);
  const rawShow = getItem('play_show_seek_controls');
  const showControls = rawShow === null ? true : rawShow === 'true';
  // 修改点：读取单手模式持久化值，未设置时保持旧行为（both）
  const handMode = sanitizeSeekHandMode(getItem('play_seek_hand_mode'), 'both');
  return { seekSeconds, showControls, handMode };
}
