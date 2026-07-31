import type {
  UpdateDiffAnalysis,
  NotificationHistory,
  NotificationSnapshot,
  WatchingUpdateChange,
  WatchingUpdateHistory,
  WatchingUpdateNotificationCandidate,
  WatchingUpdateNotificationState,
} from './watching-update-notification-types';

function sortByTitle<T extends { followId: string; title: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (left, right) =>
      left.title.localeCompare(right.title, 'zh-CN') ||
      left.followId.localeCompare(right.followId),
  );
}

function sortByFollowId<T extends { followId: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    left.followId.localeCompare(right.followId),
  );
}

function normalizeEpisode(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeSnapshot(
  snapshot: NotificationSnapshot,
): NotificationSnapshot | null {
  const followId =
    typeof snapshot.followId === 'string' ? snapshot.followId.trim() : '';
  const episode = normalizeEpisode(snapshot.episode);
  if (!followId || episode <= 0) return null;
  return { followId, episode };
}

function snapshotMap(
  snapshots: NotificationSnapshot[],
): Map<string, NotificationSnapshot> {
  const values = new Map<string, NotificationSnapshot>();
  for (const item of snapshots) {
    const snapshot = normalizeSnapshot(item);
    if (!snapshot) continue;
    const existing = values.get(snapshot.followId);
    if (!existing || snapshot.episode >= existing.episode) {
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
    const episode = normalizeEpisode(candidate.episode);
    if (!followId || !title || episode <= 0) continue;
    const normalized = { followId, title, episode };
    const existing = values.get(followId);
    if (!existing || normalized.episode >= existing.episode) {
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
  ): UpdateDiffAnalysis {
    const previousSnapshots = snapshotMap(previousState.snapshots);
    const current = candidateMap(currentCandidates);
    const history = historyMap(previousState.history);
    const newUpdates: WatchingUpdateChange[] = [];
    const nextSnapshots = new Map(previousSnapshots);

    for (const candidate of current.values()) {
      const previous = previousSnapshots.get(candidate.followId);
      if (!previous) {
        nextSnapshots.set(candidate.followId, {
          followId: candidate.followId,
          episode: candidate.episode,
        });
        continue;
      }
      if (candidate.episode <= previous.episode) continue;

      const change = {
        followId: candidate.followId,
        title: candidate.title,
        fromEpisode: previous.episode,
        toEpisode: candidate.episode,
      };
      newUpdates.push(change);
      history.set(candidate.followId, {
        followId: candidate.followId,
        fromEpisode: previous.episode,
        toEpisode: candidate.episode,
        updatedAt: new Date(checkedAt).toISOString(),
      });
      nextSnapshots.set(candidate.followId, {
        followId: candidate.followId,
        episode: candidate.episode,
      });
    }

    const newUpdateIds = new Set(newUpdates.map((item) => item.followId));
    const updatedHistory = sortByTitle<WatchingUpdateHistory>(
      [...current.values()].flatMap((candidate) => {
        const item = history.get(candidate.followId);
        return item && !newUpdateIds.has(candidate.followId)
          ? [{ ...item, title: candidate.title }]
          : [];
      }),
    );

    return {
      newUpdates: sortByTitle(newUpdates),
      updatedHistory,
      nextState: {
        snapshots: sortByFollowId([...nextSnapshots.values()]),
        history: sortByFollowId([...history.values()]),
      },
    };
  }
}

export const updateDiffAnalyzer = new UpdateDiffAnalyzer();
