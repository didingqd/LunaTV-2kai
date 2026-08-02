import type {
  UpdateDiffAnalysis,
  NotificationHistory,
  NotificationSnapshot,
  WatchingUpdateChange,
  WatchingUpdateNotificationCandidate,
  WatchingUpdateNotificationState,
} from './watching-update-notification-types';

function sortByTitle<T extends { followId: string; title: string }>(
  items: T[],
): T[] {
  return [...items].sort(compareByTitle);
}

function sortByFollowId<T extends { followId: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    left.followId.localeCompare(right.followId),
  );
}

function compareByTitle<T extends { followId: string; title: string }>(
  left: T,
  right: T,
): number {
  return (
    left.title.localeCompare(right.title, 'zh-CN') ||
    left.followId.localeCompare(right.followId)
  );
}

function historyUpdatedAtTimestamp(
  history: NotificationHistory | undefined,
): number {
  if (!history) return 0;
  const timestamp = Date.parse(history.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortUpdatedByHistory<T extends { followId: string; title: string }>(
  items: T[],
  history: Map<string, NotificationHistory>,
): T[] {
  return [...items].sort(
    (left, right) =>
      historyUpdatedAtTimestamp(history.get(right.followId)) -
        historyUpdatedAtTimestamp(history.get(left.followId)) ||
      compareByTitle(left, right),
  );
}

function normalizeEpisode(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeBaselineEpisode(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function normalizeSnapshot(
  snapshot: NotificationSnapshot,
): NotificationSnapshot | null {
  const followId =
    typeof snapshot.followId === 'string' ? snapshot.followId.trim() : '';
  const legacySnapshot = snapshot as NotificationSnapshot & {
    episode?: unknown;
    effectiveLatestEpisode?: unknown;
  };
  const effectiveLatestEpisode = normalizeEpisode(
    legacySnapshot.lastNotifiedEffectiveLatestEpisode ??
      legacySnapshot.effectiveLatestEpisode ??
      legacySnapshot.episode,
  );
  if (!followId || effectiveLatestEpisode <= 0) return null;
  return {
    followId,
    lastNotifiedEffectiveLatestEpisode: effectiveLatestEpisode,
  };
}

function snapshotMap(
  snapshots: NotificationSnapshot[],
): Map<string, NotificationSnapshot> {
  const values = new Map<string, NotificationSnapshot>();
  for (const item of snapshots) {
    const snapshot = normalizeSnapshot(item);
    if (!snapshot) continue;
    const existing = values.get(snapshot.followId);
    if (
      !existing ||
      snapshot.lastNotifiedEffectiveLatestEpisode >=
        existing.lastNotifiedEffectiveLatestEpisode
    ) {
      values.set(snapshot.followId, snapshot);
    }
  }
  return values;
}

function candidateMap(
  candidates: WatchingUpdateNotificationCandidate[],
): Map<string, WatchingUpdateNotificationCandidate> {
  const values = new Map<string, WatchingUpdateNotificationCandidate>();
  for (const candidate of candidates) {
    const followId =
      typeof candidate.followId === 'string' ? candidate.followId.trim() : '';
    const title =
      typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const fromEpisode = normalizeBaselineEpisode(candidate.fromEpisode);
    const toEpisode = normalizeEpisode(candidate.toEpisode);
    if (!followId || !title || toEpisode <= 0) continue;
    const normalized = {
      followId,
      title,
      fromEpisode,
      toEpisode,
      hasUpdate: candidate.hasUpdate === true,
    };
    const existing = values.get(followId);
    if (!existing || normalized.toEpisode >= existing.toEpisode) {
      values.set(followId, normalized);
    }
  }
  return values;
}

function historyMap(
  history: NotificationHistory[],
): Map<string, NotificationHistory> {
  const values = new Map<string, NotificationHistory>();
  for (const item of history) {
    const followId =
      typeof item.followId === 'string' ? item.followId.trim() : '';
    if (!followId) continue;
    if (
      !Number.isFinite(item.fromEpisode) ||
      !Number.isFinite(item.toEpisode) ||
      item.toEpisode <= item.fromEpisode
    ) {
      continue;
    }
    values.set(followId, {
      ...item,
      followId,
      fromEpisode: Math.max(0, Math.floor(item.fromEpisode)),
      toEpisode: Math.floor(item.toEpisode),
    });
  }
  return values;
}

export class UpdateDiffAnalyzer {
  analyze(
    currentCandidates: WatchingUpdateNotificationCandidate[],
    previousState: WatchingUpdateNotificationState,
    checkedAt: number,
    allCurrentCandidates: WatchingUpdateNotificationCandidate[] = currentCandidates,
  ): UpdateDiffAnalysis {
    const previousSnapshots = snapshotMap(previousState.snapshots);
    const current = candidateMap(currentCandidates);
    const allCurrent = candidateMap(allCurrentCandidates);
    const previousHistory = historyMap(previousState.history);
    const nextHistory = new Map<string, NotificationHistory>();
    const newUpdates: WatchingUpdateChange[] = [];
    const nextSnapshots = new Map(previousSnapshots);

    for (const candidate of current.values()) {
      if (!candidate.hasUpdate) continue;
      const previous = previousSnapshots.get(candidate.followId);
      if (!previous && candidate.toEpisode <= candidate.fromEpisode) {
        continue;
      }
      if (
        previous &&
        candidate.toEpisode <= previous.lastNotifiedEffectiveLatestEpisode
      ) {
        continue;
      }

      const change = {
        followId: candidate.followId,
        title: candidate.title,
        fromEpisode: candidate.fromEpisode,
        toEpisode: candidate.toEpisode,
      };
      newUpdates.push(change);
      if (candidate.hasUpdate) {
        nextHistory.set(candidate.followId, {
          followId: candidate.followId,
          fromEpisode: candidate.fromEpisode,
          toEpisode: candidate.toEpisode,
          updatedAt: new Date(checkedAt).toISOString(),
        });
      }
      nextSnapshots.set(candidate.followId, {
        followId: candidate.followId,
        lastNotifiedEffectiveLatestEpisode: candidate.toEpisode,
      });
    }

    const newUpdateIds = new Set(newUpdates.map((item) => item.followId));
    for (const candidate of allCurrent.values()) {
      if (!candidate.hasUpdate || newUpdateIds.has(candidate.followId)) {
        continue;
      }
      const existing = previousHistory.get(candidate.followId);
      if (!existing) continue;
      nextHistory.set(candidate.followId, {
        followId: candidate.followId,
        fromEpisode: candidate.fromEpisode,
        toEpisode: candidate.toEpisode,
        updatedAt: existing.updatedAt,
      });
    }

    const updated = sortUpdatedByHistory(
      [...allCurrent.values()].flatMap((candidate) =>
        candidate.hasUpdate &&
        !newUpdateIds.has(candidate.followId) &&
        previousHistory.has(candidate.followId) &&
        candidate.toEpisode > candidate.fromEpisode
          ? [
              {
                followId: candidate.followId,
                title: candidate.title,
                fromEpisode: candidate.fromEpisode,
                toEpisode: candidate.toEpisode,
              },
            ]
          : [],
      ),
      previousHistory,
    );

    return {
      newUpdates: sortByTitle(newUpdates),
      updated,
      nextState: {
        snapshots: sortByFollowId([...nextSnapshots.values()]),
        history: sortByFollowId([...nextHistory.values()]),
      },
    };
  }
}

export const updateDiffAnalyzer = new UpdateDiffAnalyzer();
