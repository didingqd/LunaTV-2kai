import type { PlayRecord } from './types';

export const WATCH_COMPLETION_THRESHOLD_KEY = 'watch_completion_threshold';
export const DEFAULT_WATCH_COMPLETION_THRESHOLD = 80;

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

export function sanitizeWatchCompletionThreshold(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_WATCH_COMPLETION_THRESHOLD;
  return Math.min(100, Math.max(0, Math.floor(parsed)));
}

export function loadWatchCompletionThreshold(): number {
  if (typeof window === 'undefined') return DEFAULT_WATCH_COMPLETION_THRESHOLD;
  try {
    return sanitizeWatchCompletionThreshold(
      window.localStorage.getItem(WATCH_COMPLETION_THRESHOLD_KEY),
    );
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
  const originalEpisodes = normalizeEpisodeCount(input.originalEpisodes);
  const recordTotalEpisodes = normalizeEpisodeCount(input.recordTotalEpisodes);
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
