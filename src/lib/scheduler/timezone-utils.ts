export const DEFAULT_SCHEDULER_TIMEZONE = 'UTC';

export const SCHEDULER_TIMEZONE_PRESETS = [
  'UTC',
  'Asia/Shanghai',
  'Europe/Berlin',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
] as const;

export function validateTimezone(timezone: string): boolean {
  const trimmed = timezone.trim();
  if (!trimmed) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(
  timezone: unknown,
  fallback = DEFAULT_SCHEDULER_TIMEZONE,
): string {
  if (typeof timezone !== 'string') return fallback;

  const trimmed = timezone.trim();
  return validateTimezone(trimmed) ? trimmed : fallback;
}
