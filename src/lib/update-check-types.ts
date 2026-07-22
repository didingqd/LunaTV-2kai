/**
 * Facts used by the update-check domain. These types deliberately do not
 * extend WatchingFollow or PlayRecord: both remain the source of truth.
 */

export const UPDATE_CHECK_ALGORITHM_VERSION = 1;
export const DEFAULT_UPDATE_CHECK_EXPIRE_MS = 60 * 60 * 1000;

export type UpdateResultStatus = 'fresh' | 'stale' | 'error';

export interface UpdateResultMetadata {
  algorithmVersion: number;
  completionThreshold: number;
  baselineEpisode: number;
  effectiveLatestEpisode: number;
  releasedEpisodeCount: number;
  sourceName?: string;
  cover?: string;
  year?: string;
  type?: string;
  lastError?: string;
}

export interface UpdateResult {
  userId: string;
  followId: string;
  source: string;
  resourceId: string;
  title: string;
  latestEpisode: number;
  watchedEpisode: number;
  unwatchedCount: number;
  hasUpdate: boolean;
  checkedAt: number;
  expireAt: number;
  status: UpdateResultStatus;
  revision: number;
  metadata: UpdateResultMetadata;
}

export interface UpdateObservation {
  userId: string;
  followId: string;
  source: string;
  resourceId: string;
  latestEpisode: number;
  observedAt: number;
  clientId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCheckTask {
  id: string;
  userId: string;
  followId: string;
  source: string;
  resourceId: string;
  nextCheckAt: number;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
}
