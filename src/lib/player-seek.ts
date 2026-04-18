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

// 修改点：快进快退时长合并为统一配置，兼容旧键值读取
export function readSeekConfigFromStorage(getItem: (key: string) => string | null) {
  const unified = getItem('play_seek_seconds');
  const legacyBackward = getItem('play_seek_backward_seconds');
  const legacyForward = getItem('play_seek_forward_seconds');
  const seekSeconds = sanitizeSeekSeconds(unified ?? legacyForward ?? legacyBackward, 10);
  const rawShow = getItem('play_show_seek_controls');
  const showControls = rawShow === null ? true : rawShow === 'true';
  return { seekSeconds, showControls };
}
