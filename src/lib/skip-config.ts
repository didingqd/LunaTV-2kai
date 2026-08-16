import type { SkipConfig } from './types';

export function normalizeSkipConfigValue(value: unknown): SkipConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const introTime = readSeconds(raw.intro_time);
  const outroTime = readSeconds(raw.outro_time, { legacyNegative: true });
  if (introTime === null || outroTime === null) return null;

  return {
    // 共享 API 的 enable 是系列/资源级开关；历史缺省值按是否有实际跳过秒数推断，
    // 避免旧数据缺字段时在 App 与 Web 间产生空开启状态。
    enable: readBoolean(raw.enable) ?? (introTime > 0 || outroTime > 0),
    intro_time: introTime,
    outro_time: outroTime,
  };
}

export function normalizeSkipConfigRecord(
  values: Record<string, SkipConfig>,
): Record<string, SkipConfig> {
  const normalized: Record<string, SkipConfig> = {};
  for (const [key, value] of Object.entries(values)) {
    const config = normalizeSkipConfigValue(value);
    if (config) normalized[key] = config;
  }
  return normalized;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function readSeconds(
  value: unknown,
  options: { legacyNegative?: boolean } = {},
): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : null;
  if (parsed === null || !Number.isFinite(parsed)) return null;
  const wholeSeconds = Math.floor(parsed);
  if (options.legacyNegative && wholeSeconds < 0) return -wholeSeconds;
  return Math.max(0, wholeSeconds);
}
