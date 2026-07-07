export const OUTRO_SKIP_HINT_LEAD_SECONDS_KEY = 'outro_skip_hint_lead_seconds';
export const OUTRO_SKIP_HINT_LEAD_SECONDS_CHANGE_EVENT =
  'outro-skip-hint-lead-seconds-change';
export const DEFAULT_OUTRO_SKIP_HINT_LEAD_SECONDS = 5;
export const MIN_OUTRO_SKIP_HINT_LEAD_SECONDS = 0;
export const MAX_OUTRO_SKIP_HINT_LEAD_SECONDS = 10;

export function sanitizeOutroSkipHintLeadSeconds(value: unknown): number {
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
