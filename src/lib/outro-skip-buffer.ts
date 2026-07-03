export const OUTRO_SKIP_BUFFER_KEY = 'moontv_outro_skip_buffer_seconds';
export const OUTRO_SKIP_BUFFER_CHANGE_EVENT = 'moontv:outro-skip-buffer-change';
export const DEFAULT_OUTRO_SKIP_BUFFER_SECONDS = 2;
export const OUTRO_SKIP_BUFFER_MIN_SECONDS = 0;
export const OUTRO_SKIP_BUFFER_MAX_SECONDS = 10;
const OUTRO_SKIP_BUFFER_PRECISION = 10;

export function sanitizeOutroSkipBufferSeconds(value: unknown): number {
  const numericValue =
    typeof value === 'string' ? Number(value) : Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_OUTRO_SKIP_BUFFER_SECONDS;
  }

  const clampedValue = Math.max(
    OUTRO_SKIP_BUFFER_MIN_SECONDS,
    Math.min(OUTRO_SKIP_BUFFER_MAX_SECONDS, numericValue),
  );
  return (
    Math.round(clampedValue * OUTRO_SKIP_BUFFER_PRECISION) /
    OUTRO_SKIP_BUFFER_PRECISION
  );
}

export function formatOutroSkipBufferSeconds(value: number): string {
  const sanitizedValue = sanitizeOutroSkipBufferSeconds(value);
  return Number.isInteger(sanitizedValue)
    ? String(sanitizedValue)
    : sanitizedValue.toFixed(1);
}

export function loadOutroSkipBufferSeconds(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_OUTRO_SKIP_BUFFER_SECONDS;
  }

  return sanitizeOutroSkipBufferSeconds(
    localStorage.getItem(OUTRO_SKIP_BUFFER_KEY),
  );
}

export function saveOutroSkipBufferSeconds(value: number): number {
  const nextValue = sanitizeOutroSkipBufferSeconds(value);
  localStorage.setItem(OUTRO_SKIP_BUFFER_KEY, String(nextValue));
  window.dispatchEvent(
    new CustomEvent(OUTRO_SKIP_BUFFER_CHANGE_EVENT, {
      detail: { value: nextValue },
    }),
  );
  return nextValue;
}
