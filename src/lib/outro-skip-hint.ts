export const OUTRO_SKIP_HINT_LEAD_SECONDS_KEY = 'outro_skip_hint_lead_seconds';
export const OUTRO_SKIP_HINT_LEAD_SECONDS_CHANGE_EVENT =
  'outro-skip-hint-lead-seconds-change';
export const OUTRO_SKIP_END_OFFSET_SECONDS_KEY =
  'outro_skip_end_offset_seconds';
export const OUTRO_SKIP_END_OFFSET_SECONDS_CHANGE_EVENT =
  'outro-skip-end-offset-seconds-change';
export const DEFAULT_OUTRO_SKIP_HINT_LEAD_SECONDS = 5;
export const MIN_OUTRO_SKIP_HINT_LEAD_SECONDS = 0;
export const MAX_OUTRO_SKIP_HINT_LEAD_SECONDS = 10;
export const DEFAULT_OUTRO_SKIP_END_OFFSET_SECONDS = 0.5;
export const MIN_OUTRO_SKIP_END_OFFSET_SECONDS = 0;
export const MAX_OUTRO_SKIP_END_OFFSET_SECONDS = 10;

export function sanitizeOutroSkipHintLeadSeconds(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return DEFAULT_OUTRO_SKIP_HINT_LEAD_SECONDS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OUTRO_SKIP_HINT_LEAD_SECONDS;
  }

  return Math.max(
    MIN_OUTRO_SKIP_HINT_LEAD_SECONDS,
    Math.min(MAX_OUTRO_SKIP_HINT_LEAD_SECONDS, Math.round(parsed)),
  );
}

export function loadOutroSkipHintLeadSeconds(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_OUTRO_SKIP_HINT_LEAD_SECONDS;
  }

  return sanitizeOutroSkipHintLeadSeconds(
    localStorage.getItem(OUTRO_SKIP_HINT_LEAD_SECONDS_KEY),
  );
}

export function saveOutroSkipHintLeadSeconds(value: number): number {
  const nextValue = sanitizeOutroSkipHintLeadSeconds(value);
  localStorage.setItem(OUTRO_SKIP_HINT_LEAD_SECONDS_KEY, String(nextValue));
  window.dispatchEvent(
    new CustomEvent(OUTRO_SKIP_HINT_LEAD_SECONDS_CHANGE_EVENT, {
      detail: nextValue,
    }),
  );
  return nextValue;
}

export function sanitizeOutroSkipEndOffsetSeconds(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return DEFAULT_OUTRO_SKIP_END_OFFSET_SECONDS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OUTRO_SKIP_END_OFFSET_SECONDS;
  }

  const clamped = Math.max(
    MIN_OUTRO_SKIP_END_OFFSET_SECONDS,
    Math.min(MAX_OUTRO_SKIP_END_OFFSET_SECONDS, parsed),
  );
  return Math.round(clamped * 10) / 10;
}

export function loadOutroSkipEndOffsetSeconds(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_OUTRO_SKIP_END_OFFSET_SECONDS;
  }

  return sanitizeOutroSkipEndOffsetSeconds(
    localStorage.getItem(OUTRO_SKIP_END_OFFSET_SECONDS_KEY),
  );
}

export function saveOutroSkipEndOffsetSeconds(value: number): number {
  const nextValue = sanitizeOutroSkipEndOffsetSeconds(value);
  localStorage.setItem(OUTRO_SKIP_END_OFFSET_SECONDS_KEY, String(nextValue));
  window.dispatchEvent(
    new CustomEvent(OUTRO_SKIP_END_OFFSET_SECONDS_CHANGE_EVENT, {
      detail: nextValue,
    }),
  );
  return nextValue;
}
