import type { PlayRecord } from './types';

export const WATCH_COMPLETION_THRESHOLD_KEY = 'watch_completion_threshold';
export const DEFAULT_WATCH_COMPLETION_THRESHOLD = 80;
export const WATCH_COMPLETION_THRESHOLD_CACHE_PREFIX =
  'moontv_watch_completion_threshold_v1';
export const WATCH_COMPLETION_THRESHOLD_ENDPOINT =
  '/api/user/watch-completion-threshold';

type ThresholdStorageReader = Pick<Storage, 'getItem'>;
type ThresholdStorageWriter = Pick<Storage, 'setItem'>;
type ThresholdStorageRemover = Partial<Pick<Storage, 'removeItem'>>;
type ThresholdStorage = ThresholdStorageReader &
  ThresholdStorageWriter &
  ThresholdStorageRemover;
type ThresholdFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface WatchingUpdateCalculationInput {
  detailEpisodes: unknown;
  originalEpisodes: unknown;
  recordTotalEpisodes: unknown;
  watchedEpisodes: unknown;
}

export interface WatchingUpdateCalculationResult {
  latestEpisodes: number;
  watchedEpisodes: number;
  baselineEpisodes: number;
  newEpisodes: number;
  remainingEpisodes: number;
  hasUpdate: boolean;
}

export function normalizeEpisodeCount(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function resolveEffectiveOriginalEpisodes(
  followOriginalEpisodes: unknown,
  detailEpisodes: unknown,
  recordTotalEpisodes: unknown,
): number {
  const followEpisodes = normalizeEpisodeCount(followOriginalEpisodes);
  if (followEpisodes > 0) return followEpisodes;

  const detailEpisodeCount = normalizeEpisodeCount(detailEpisodes);
  if (detailEpisodeCount > 0) return detailEpisodeCount;

  const recordEpisodes = normalizeEpisodeCount(recordTotalEpisodes);
  if (recordEpisodes > 0) return recordEpisodes;

  return 1;
}

export function sanitizeWatchCompletionThreshold(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_WATCH_COMPLETION_THRESHOLD;
  return Math.min(100, Math.max(0, Math.floor(parsed)));
}

export function watchCompletionThresholdStorageKey(username: string): string {
  return `${WATCH_COMPLETION_THRESHOLD_CACHE_PREFIX}:${encodeURIComponent(username)}`;
}

export function clearLegacyWatchCompletionThresholdCache(
  storage?: ThresholdStorageRemover,
): void {
  const targetStorage =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  try {
    targetStorage?.removeItem?.(WATCH_COMPLETION_THRESHOLD_KEY);
  } catch {
    // Legacy cache cleanup is best-effort; calculation must still fall back.
  }
}

function clearScopedWatchCompletionThresholdCache(
  username: string,
  storage?: ThresholdStorageRemover,
): void {
  const targetStorage =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  try {
    targetStorage?.removeItem?.(watchCompletionThresholdStorageKey(username));
  } catch {
    // Scoped cache cleanup is best-effort; Backend preference is authoritative.
  }
}

export function loadWatchCompletionThreshold(
  username?: string | null,
  storage?: ThresholdStorageReader,
): number {
  const principal = username?.trim();
  if (!principal) return DEFAULT_WATCH_COMPLETION_THRESHOLD;

  const targetStorage =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!targetStorage) return DEFAULT_WATCH_COMPLETION_THRESHOLD;

  try {
    return sanitizeWatchCompletionThreshold(
      targetStorage.getItem(watchCompletionThresholdStorageKey(principal)),
    );
  } catch {
    return DEFAULT_WATCH_COMPLETION_THRESHOLD;
  }
}

export function cacheWatchCompletionThreshold(
  username: string | null | undefined,
  threshold: unknown,
  storage?: ThresholdStorageWriter,
): number {
  const normalized = sanitizeWatchCompletionThreshold(threshold);
  const principal = username?.trim();
  if (!principal) return normalized;

  const targetStorage =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!targetStorage) return normalized;

  try {
    targetStorage.setItem(
      watchCompletionThresholdStorageKey(principal),
      String(normalized),
    );
  } catch {
    // Storage write failures should not block Watching Update calculation.
  }
  return normalized;
}

export async function resolveWatchCompletionThresholdPreference({
  username,
  fetcher,
  storage,
}: {
  username?: string | null;
  fetcher?: ThresholdFetch;
  storage?: ThresholdStorage;
}): Promise<number> {
  clearLegacyWatchCompletionThresholdCache(storage);
  const principal = username?.trim();
  if (!principal) return DEFAULT_WATCH_COMPLETION_THRESHOLD;
  clearScopedWatchCompletionThresholdCache(principal, storage);

  try {
    const request = fetcher ?? fetch;
    const response = await request(WATCH_COMPLETION_THRESHOLD_ENDPOINT, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Failed to load watch threshold');
    const data = (await response.json()) as {
      watchCompletionThreshold?: unknown;
    };
    return sanitizeWatchCompletionThreshold(data.watchCompletionThreshold);
  } catch {
    return DEFAULT_WATCH_COMPLETION_THRESHOLD;
  }
}

export function isPlaybackCompleted(
  playTime: unknown,
  totalTime: unknown,
  threshold: unknown,
): boolean {
  const normalizedThreshold = sanitizeWatchCompletionThreshold(threshold);
  if (normalizedThreshold <= 0) return true;

  const normalizedPlayTime = normalizeEpisodeCount(playTime);
  const normalizedTotalTime = normalizeEpisodeCount(totalTime);
  if (normalizedPlayTime < 1 || normalizedTotalTime <= 0) return false;

  return (
    (normalizedPlayTime / normalizedTotalTime) * 100 >= normalizedThreshold
  );
}

export function watchedEpisodesForRecord(
  record: Pick<PlayRecord, 'index' | 'play_time' | 'total_time'>,
  threshold: unknown,
): number {
  const episode = normalizeEpisodeCount(record.index);
  if (episode <= 0) return 0;
  return isPlaybackCompleted(record.play_time, record.total_time, threshold)
    ? episode
    : episode - 1;
}

export function calculateWatchingUpdate(
  input: WatchingUpdateCalculationInput,
): WatchingUpdateCalculationResult {
  const detailEpisodes = normalizeEpisodeCount(input.detailEpisodes);
  const recordTotalEpisodes = normalizeEpisodeCount(input.recordTotalEpisodes);
  const originalEpisodes = resolveEffectiveOriginalEpisodes(
    input.originalEpisodes,
    detailEpisodes,
    recordTotalEpisodes,
  );
  const watchedEpisodes = normalizeEpisodeCount(input.watchedEpisodes);
  const latestEpisodes = Math.max(
    detailEpisodes,
    originalEpisodes,
    recordTotalEpisodes,
  );
  const baselineEpisodes = Math.max(originalEpisodes, watchedEpisodes);
  const newEpisodes = Math.max(0, latestEpisodes - baselineEpisodes);
  const remainingEpisodes = Math.max(0, latestEpisodes - watchedEpisodes);

  return {
    latestEpisodes,
    watchedEpisodes,
    baselineEpisodes,
    newEpisodes,
    remainingEpisodes,
    hasUpdate: newEpisodes > 0,
  };
}
