import { resolveContentIdentity } from './content-identity';
import {
  normalizeEpisodeCount,
  type WatchingUpdateCalculationResult,
} from './watching-update-calculation';
import type { PlayRecord, WatchingFollow } from './types';

export interface WatchingUpdateItem {
  title: string;
  sourceName: string;
  source_name: string;
  year: string;
  cover: string;
  identityKey: string;
  source: string;
  id: string;
  sourceKey: string;
  videoId: string;
  currentEpisode: number;
  totalEpisodes: number;
  hasNewEpisode: boolean;
  hasContinueWatching: boolean;
  hasNewRelease: boolean;
  newEpisodes: number;
  remainingEpisodes: number;
  releasedEpisodes: number;
  unwatchedEpisodes: number;
  latestEpisodes: number;
  completed: boolean;
  detectedAt?: number;
  remarks?: string;
  releaseDate?: string;
  detailDate?: string;
}

export interface WatchingUpdate {
  hasUpdates: boolean;
  timestamp: number;
  updatedCount: number;
  continueWatchingCount: number;
  newReleasesCount: number;
  updatedSeries: WatchingUpdateItem[];
}

export interface WatchingUpdateDetail {
  title?: unknown;
  cover?: unknown;
  poster?: unknown;
  year?: unknown;
  source?: unknown;
  sourceName?: unknown;
  source_name?: unknown;
  releaseDate?: unknown;
}

type WatchingUpdateRecord = PlayRecord & {
  source?: unknown;
  releaseDate?: unknown;
};

export function mapWatchingUpdateItem({
  follow,
  record,
  detail,
  calculation,
  detectedAt,
}: {
  follow: WatchingFollow;
  record: WatchingUpdateRecord;
  detail: WatchingUpdateDetail;
  calculation: WatchingUpdateCalculationResult;
  detectedAt?: number;
}): WatchingUpdateItem {
  const identity = resolveContentIdentity(follow);
  if (!identity) throw new Error('WatchingUpdate identity is invalid');
  const { source, id, identityKey } = identity;
  const sourceName = firstNonEmpty([
    record.source_name,
    record.source,
    detail.source_name,
    detail.sourceName,
    detail.source,
    source,
  ]);
  const releasedEpisodes = calculation.newEpisodes;
  const unwatchedEpisodes = calculation.remainingEpisodes;

  return {
    title: firstNonEmpty([follow.title, record.title, detail.title]),
    sourceName,
    source_name: sourceName,
    year: firstNonEmpty([follow.year, record.year, detail.year]),
    cover: firstNonEmpty([
      follow.cover,
      record.cover,
      detail.cover,
      detail.poster,
    ]),
    identityKey,
    source,
    id,
    sourceKey: source,
    videoId: id,
    currentEpisode: calculation.watchedEpisodes,
    totalEpisodes: calculation.latestEpisodes,
    hasNewEpisode: calculation.hasUpdate,
    hasContinueWatching: false,
    hasNewRelease: false,
    newEpisodes: calculation.newEpisodes,
    remainingEpisodes: calculation.remainingEpisodes,
    releasedEpisodes,
    unwatchedEpisodes,
    latestEpisodes: calculation.latestEpisodes,
    completed: calculation.watchedEpisodes >= calculation.latestEpisodes,
    detectedAt,
    remarks: optionalString(record.remarks),
    releaseDate: optionalString(record.releaseDate),
    detailDate: optionalString(detail.releaseDate),
  };
}

export function normalizeWatchingUpdate(
  value: unknown,
): WatchingUpdate | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const updatedSeries = Array.isArray(raw.updatedSeries)
    ? raw.updatedSeries
        .map(normalizeWatchingUpdateItem)
        .filter((item): item is WatchingUpdateItem => item !== null)
    : [];
  const updatedCount = episodeCountOrFallback(
    raw.updatedCount,
    updatedSeries.filter((item) => item.hasNewEpisode).length,
  );
  const continueWatchingCount = episodeCountOrFallback(
    raw.continueWatchingCount,
    updatedSeries.filter((item) => item.hasContinueWatching).length,
  );
  const newReleasesCount = episodeCountOrFallback(
    raw.newReleasesCount,
    updatedSeries.filter((item) => item.hasNewRelease).length,
  );

  return {
    hasUpdates:
      typeof raw.hasUpdates === 'boolean'
        ? raw.hasUpdates
        : updatedCount + newReleasesCount > 0,
    timestamp: normalizeEpisodeCount(raw.timestamp),
    updatedCount,
    continueWatchingCount,
    newReleasesCount,
    updatedSeries,
  };
}

export function normalizeWatchingUpdateItem(
  value: unknown,
): WatchingUpdateItem | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const identity = resolveContentIdentity(raw);
  if (!identity) return null;
  const { source, id, identityKey } = identity;

  const sourceName = firstNonEmpty([raw.sourceName, raw.source_name, source]);
  const latestEpisodes = normalizeEpisodeCount(
    raw.latestEpisodes ?? raw.totalEpisodes,
  );
  const normalizedTotalEpisodes = normalizeEpisodeCount(raw.totalEpisodes);
  const currentEpisode = normalizeEpisodeCount(raw.currentEpisode);
  const newEpisodes = normalizeEpisodeCount(
    raw.newEpisodes ?? raw.releasedEpisodes,
  );
  const remainingEpisodes = normalizeEpisodeCount(
    raw.remainingEpisodes ?? raw.unwatchedEpisodes,
  );

  return {
    title: firstNonEmpty([raw.title]),
    sourceName,
    source_name: sourceName,
    year: firstNonEmpty([raw.year]),
    cover: firstNonEmpty([raw.cover]),
    identityKey,
    source,
    id,
    sourceKey: source,
    videoId: id,
    currentEpisode,
    totalEpisodes:
      normalizedTotalEpisodes > 0 ? normalizedTotalEpisodes : latestEpisodes,
    hasNewEpisode: raw.hasNewEpisode === true,
    hasContinueWatching: raw.hasContinueWatching === true,
    hasNewRelease: raw.hasNewRelease === true,
    newEpisodes,
    remainingEpisodes,
    releasedEpisodes: newEpisodes,
    unwatchedEpisodes: remainingEpisodes,
    latestEpisodes,
    completed: currentEpisode >= latestEpisodes,
    detectedAt: optionalTimestamp(raw.detectedAt),
    remarks: optionalString(raw.remarks),
    releaseDate: optionalString(raw.releaseDate),
    detailDate: optionalString(raw.detailDate),
  };
}

function firstNonEmpty(values: unknown[]): string {
  for (const value of values) {
    const normalized = optionalString(value);
    if (normalized) return normalized;
  }
  return '';
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function optionalTimestamp(value: unknown): number | undefined {
  const timestamp =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(timestamp) && timestamp > 0
    ? Math.floor(timestamp)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function episodeCountOrFallback(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  return normalizeEpisodeCount(value);
}
