import type {
  UpdateCheckSnapshot,
  UpdateDiffAnalysis,
  UpdateHistory,
  WatchingUpdateChange,
  WatchingUpdateNotificationState,
} from './watching-update-notification-types';

function sortByTitle<T extends { id: string; title: string }>(items: T[]): T[] {
  return [...items].sort(
    (left, right) =>
      left.title.localeCompare(right.title, 'zh-CN') ||
      left.id.localeCompare(right.id),
  );
}

function normalizeEpisode(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeSnapshot(
  snapshot: UpdateCheckSnapshot,
): UpdateCheckSnapshot | null {
  const id = snapshot.id.trim();
  const title = snapshot.title.trim();
  const episode = normalizeEpisode(snapshot.episode);
  if (!id || !title || episode <= 0) return null;
  return { id, title, episode };
}

function snapshotMap(
  snapshots: UpdateCheckSnapshot[],
): Map<string, UpdateCheckSnapshot> {
  const values = new Map<string, UpdateCheckSnapshot>();
  for (const item of snapshots) {
    const snapshot = normalizeSnapshot(item);
    if (!snapshot) continue;
    const existing = values.get(snapshot.id);
    if (!existing || snapshot.episode >= existing.episode) {
      values.set(snapshot.id, snapshot);
    }
  }
  return values;
}

function historyMap(history: UpdateHistory[]): Map<string, UpdateHistory> {
  const values = new Map<string, UpdateHistory>();
  for (const item of history) {
    const id = item.id.trim();
    const title = item.title.trim();
    if (!id || !title) continue;
    if (
      !Number.isFinite(item.fromEpisode) ||
      !Number.isFinite(item.toEpisode) ||
      item.toEpisode <= item.fromEpisode
    ) {
      continue;
    }
    values.set(id, {
      ...item,
      id,
      title,
      fromEpisode: Math.max(0, Math.floor(item.fromEpisode)),
      toEpisode: Math.floor(item.toEpisode),
    });
  }
  return values;
}

export class UpdateDiffAnalyzer {
  analyze(
    currentSnapshots: UpdateCheckSnapshot[],
    previousState: WatchingUpdateNotificationState,
    checkedAt: number,
  ): UpdateDiffAnalysis {
    const previousSnapshots = snapshotMap(previousState.snapshots);
    const current = snapshotMap(currentSnapshots);
    const history = historyMap(previousState.history);
    const newUpdates: WatchingUpdateChange[] = [];

    for (const snapshot of current.values()) {
      const previousEpisode = previousSnapshots.get(snapshot.id)?.episode ?? 0;
      if (snapshot.episode <= previousEpisode) continue;

      const change = {
        id: snapshot.id,
        title: snapshot.title,
        fromEpisode: previousEpisode,
        toEpisode: snapshot.episode,
      };
      newUpdates.push(change);
      history.set(snapshot.id, {
        ...change,
        updatedAt: new Date(checkedAt).toISOString(),
      });
    }

    const newUpdateIds = new Set(newUpdates.map((item) => item.id));
    const updatedHistory = sortByTitle(
      [...current.keys()].flatMap((id) => {
        const item = history.get(id);
        return item && !newUpdateIds.has(id) ? [item] : [];
      }),
    );
    const nextSnapshots = new Map(previousSnapshots);
    for (const snapshot of current.values()) {
      nextSnapshots.set(snapshot.id, snapshot);
    }

    return {
      newUpdates: sortByTitle(newUpdates),
      updatedHistory,
      nextState: {
        snapshots: sortByTitle([...nextSnapshots.values()]),
        history: sortByTitle([...history.values()]),
      },
    };
  }
}

export const updateDiffAnalyzer = new UpdateDiffAnalyzer();
