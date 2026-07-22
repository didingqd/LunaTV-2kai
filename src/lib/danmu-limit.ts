export const DANMU_SEGMENT_SECONDS = 300;
export const DEFAULT_DANMU_SEGMENT_LIMIT = 0;
export const DANMU_SEGMENT_LIMIT_STORAGE_PREFIX = 'moontv_danmu_segment_limit';
export const DANMU_SEGMENT_LIMIT_CHANGE_EVENT =
  'moontv_danmu_segment_limit_change';

export const DANMU_SEGMENT_LIMIT_OPTIONS = [
  { value: 500, label: '500' },
  { value: 1000, label: '1000' },
  { value: 3000, label: '3000' },
  { value: 5000, label: '5000' },
  { value: 10000, label: '10000' },
  { value: 0, label: '不限' },
] as const;

export interface DanmuSegmentLimitScope {
  mode: 'user' | 'local';
  principal: string;
}

export interface DanmuSegmentLimitChangeDetail {
  limit: number;
  scope: DanmuSegmentLimitScope;
  storageKey: string;
}

export function resolveDanmuSegmentLimitScope(
  username?: string | null,
): DanmuSegmentLimitScope {
  const principal = username?.trim();
  if (principal) {
    return { mode: 'user', principal };
  }

  return { mode: 'local', principal: 'local' };
}

export function danmuSegmentLimitStorageKey(
  scope: DanmuSegmentLimitScope,
): string {
  return `${DANMU_SEGMENT_LIMIT_STORAGE_PREFIX}:${scope.mode}:${encodeURIComponent(scope.principal)}`;
}

export function sanitizeDanmuSegmentLimit(
  value: unknown,
  fallback = DEFAULT_DANMU_SEGMENT_LIMIT,
): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function loadDanmuSegmentLimit(
  username?: string | null,
  storage?: Pick<Storage, 'getItem'>,
): number {
  const targetStorage =
    storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!targetStorage) return DEFAULT_DANMU_SEGMENT_LIMIT;

  try {
    const scope = resolveDanmuSegmentLimitScope(username);
    return sanitizeDanmuSegmentLimit(
      targetStorage.getItem(danmuSegmentLimitStorageKey(scope)),
    );
  } catch {
    return DEFAULT_DANMU_SEGMENT_LIMIT;
  }
}

export function saveDanmuSegmentLimit(
  limit: number,
  username?: string | null,
  storage?: Pick<Storage, 'setItem'>,
): number {
  const nextLimit = sanitizeDanmuSegmentLimit(limit);
  const targetStorage =
    storage || (typeof window !== 'undefined' ? window.localStorage : null);
  const scope = resolveDanmuSegmentLimitScope(username);
  const storageKey = danmuSegmentLimitStorageKey(scope);

  if (targetStorage) {
    targetStorage.setItem(storageKey, String(nextLimit));
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<DanmuSegmentLimitChangeDetail>(
        DANMU_SEGMENT_LIMIT_CHANGE_EVENT,
        {
          detail: { limit: nextLimit, scope, storageKey },
        },
      ),
    );
  }

  return nextLimit;
}

export function applyDanmuSegmentLimit<T extends { time?: unknown }>(
  danmu: readonly T[],
  limit: number,
  segmentSeconds = DANMU_SEGMENT_SECONDS,
): T[] {
  const safeLimit = sanitizeDanmuSegmentLimit(limit);
  if (safeLimit === 0) return [...danmu];

  const safeSegmentSeconds =
    Number.isFinite(segmentSeconds) && segmentSeconds > 0
      ? segmentSeconds
      : DANMU_SEGMENT_SECONDS;
  const segmentCounts = new Map<number, number>();
  const result: T[] = [];

  for (const item of danmu) {
    const rawTime =
      typeof item.time === 'number' ? item.time : Number(item.time);
    const safeTime = Number.isFinite(rawTime) && rawTime >= 0 ? rawTime : 0;
    const segmentIndex = Math.floor(safeTime / safeSegmentSeconds);
    const count = segmentCounts.get(segmentIndex) || 0;

    if (count >= safeLimit) continue;

    segmentCounts.set(segmentIndex, count + 1);
    result.push(item);
  }

  return result;
}
