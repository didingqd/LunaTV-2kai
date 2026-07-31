import type {
  UpdateCheckTask,
  UpdateObservation,
  UpdateResult,
} from './update-check-types';
import type { WatchingUpdateNotificationState } from './watching-update-notification-types';

export interface UpdateCacheStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown, expireSeconds?: number): Promise<void>;
  deleteCache(key: string): Promise<void>;
}

export interface UpdateResultRepository {
  getAll(userId: string): Promise<UpdateResult[]>;
  get(userId: string, followId: string): Promise<UpdateResult | null>;
  save(result: UpdateResult): Promise<void>;
  delete(userId: string, followId: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface UpdateObservationRepository {
  get(userId: string, followId: string): Promise<UpdateObservation | null>;
  save(observation: UpdateObservation): Promise<void>;
  delete(userId: string, followId: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface UpdateCheckTaskRepository {
  get(id: string): Promise<UpdateCheckTask | null>;
  save(task: UpdateCheckTask): Promise<void>;
  listDue(now: number, limit: number): Promise<UpdateCheckTask[]>;
  delete(id: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface UpdateCheckScheduleTaskRepository {
  listTasksByUser(username: string): Promise<UpdateCheckTask[]>;
  listAllUsersWithTasks(): Promise<string[]>;
  findEarliestNextCheckAt(): Promise<number | null>;
  batchUpdateNextCheckAt(
    username: string,
    nextCheckAt: number,
  ): Promise<number>;
}

export interface WatchingUpdateNotificationStateRepository {
  get(userId: string): Promise<WatchingUpdateNotificationState>;
  save(userId: string, state: WatchingUpdateNotificationState): Promise<void>;
  deleteForFollow(userId: string, followId: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

const RESULT_PREFIX = 'watching-update:results:v1:';
const OBSERVATION_PREFIX = 'watching-update:observations:v1:';
const NOTIFICATION_STATE_PREFIX = 'watching-update:notification-state:v1:';
const TASK_INDEX_KEY = 'watching-update:tasks:v1:index';
const TASK_PREFIX = 'watching-update:tasks:v1:item:';
const USER_TASK_PREFIX = 'watching-update:tasks:v1:user:';
const writeQueues = new Map<string, Promise<void>>();

function userKey(prefix: string, userId: string): string {
  return `${prefix}${encodeURIComponent(userId)}`;
}

function taskId(userId: string, followId: string): string {
  return encodeURIComponent(JSON.stringify([userId, followId]));
}

function taskKey(id: string): string {
  return `${TASK_PREFIX}${encodeURIComponent(id)}`;
}

function userTaskKey(userId: string): string {
  return `${USER_TASK_PREFIX}${encodeURIComponent(userId)}`;
}

interface TaskIndexEntry {
  id: string;
  nextCheckAt: number;
}

function asTaskIndex(value: unknown): TaskIndexEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') {
      // Accept the pre-index format so deployments can upgrade in place.
      return [{ id: item, nextCheckAt: Number.NEGATIVE_INFINITY }];
    }
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<TaskIndexEntry>;
    return typeof entry.id === 'string' && typeof entry.nextCheckAt === 'number'
      ? [{ id: entry.id, nextCheckAt: entry.nextCheckAt }]
      : [];
  });
}

function asIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asMap<T>(value: unknown): Record<string, T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, T>;
}

function asNotificationState(value: unknown): WatchingUpdateNotificationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { snapshots: [], history: [] };
  }
  const state = value as Partial<WatchingUpdateNotificationState>;
  return {
    snapshots: Array.isArray(state.snapshots) ? state.snapshots : [],
    history: Array.isArray(state.history) ? state.history : [],
  };
}

async function queuedWrite<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  writeQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  }
}

export class CachedUpdateResultRepository implements UpdateResultRepository {
  constructor(private readonly store: UpdateCacheStore) {}

  async getAll(userId: string): Promise<UpdateResult[]> {
    return Object.values(
      asMap<UpdateResult>(
        await this.store.getCache(userKey(RESULT_PREFIX, userId)),
      ),
    ).filter((value) => value?.userId === userId);
  }

  async get(userId: string, followId: string): Promise<UpdateResult | null> {
    const value = asMap<UpdateResult>(
      await this.store.getCache(userKey(RESULT_PREFIX, userId)),
    )[followId];
    return value?.userId === userId ? value : null;
  }

  async save(result: UpdateResult): Promise<void> {
    const key = userKey(RESULT_PREFIX, result.userId);
    await queuedWrite(key, async () => {
      const values = asMap<UpdateResult>(await this.store.getCache(key));
      values[result.followId] = result;
      await this.store.setCache(key, values);
    });
  }

  async delete(userId: string, followId: string): Promise<void> {
    const key = userKey(RESULT_PREFIX, userId);
    await queuedWrite(key, async () => {
      const values = asMap<UpdateResult>(await this.store.getCache(key));
      delete values[followId];
      await this.store.setCache(key, values);
    });
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.store.deleteCache(userKey(RESULT_PREFIX, userId));
  }
}

export class CachedUpdateObservationRepository implements UpdateObservationRepository {
  constructor(private readonly store: UpdateCacheStore) {}

  async get(
    userId: string,
    followId: string,
  ): Promise<UpdateObservation | null> {
    const value = asMap<UpdateObservation>(
      await this.store.getCache(userKey(OBSERVATION_PREFIX, userId)),
    )[followId];
    return value?.userId === userId ? value : null;
  }

  async save(observation: UpdateObservation): Promise<void> {
    const key = userKey(OBSERVATION_PREFIX, observation.userId);
    await queuedWrite(key, async () => {
      const values = asMap<UpdateObservation>(await this.store.getCache(key));
      const previous = values[observation.followId];
      if (!previous || observation.observedAt >= previous.observedAt) {
        values[observation.followId] = observation;
        await this.store.setCache(key, values);
      }
    });
  }

  async delete(userId: string, followId: string): Promise<void> {
    const key = userKey(OBSERVATION_PREFIX, userId);
    await queuedWrite(key, async () => {
      const values = asMap<UpdateObservation>(await this.store.getCache(key));
      delete values[followId];
      await this.store.setCache(key, values);
    });
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.store.deleteCache(userKey(OBSERVATION_PREFIX, userId));
  }
}

export class CachedWatchingUpdateNotificationStateRepository implements WatchingUpdateNotificationStateRepository {
  constructor(private readonly store: UpdateCacheStore) {}

  async get(userId: string): Promise<WatchingUpdateNotificationState> {
    return asNotificationState(
      await this.store.getCache(userKey(NOTIFICATION_STATE_PREFIX, userId)),
    );
  }

  async save(
    userId: string,
    state: WatchingUpdateNotificationState,
  ): Promise<void> {
    const key = userKey(NOTIFICATION_STATE_PREFIX, userId);
    await queuedWrite(key, async () => {
      await this.store.setCache(key, state);
    });
  }

  async deleteForFollow(userId: string, followId: string): Promise<void> {
    const key = userKey(NOTIFICATION_STATE_PREFIX, userId);
    await queuedWrite(key, async () => {
      const state = asNotificationState(await this.store.getCache(key));
      const snapshots = state.snapshots.filter(
        (snapshot) => snapshot.followId !== followId,
      );
      const history = state.history.filter(
        (item) => item.followId !== followId,
      );
      if (snapshots.length === 0 && history.length === 0) {
        await this.store.deleteCache(key);
        return;
      }
      await this.store.setCache(key, { snapshots, history });
    });
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.store.deleteCache(userKey(NOTIFICATION_STATE_PREFIX, userId));
  }
}

export class CachedUpdateCheckTaskRepository
  implements UpdateCheckTaskRepository, UpdateCheckScheduleTaskRepository
{
  constructor(private readonly store: UpdateCacheStore) {}

  async get(id: string): Promise<UpdateCheckTask | null> {
    const value = await this.store.getCache(taskKey(id));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as UpdateCheckTask)
      : null;
  }

  async save(task: UpdateCheckTask): Promise<void> {
    await queuedWrite(TASK_INDEX_KEY, async () => {
      const index = asTaskIndex(
        await this.store.getCache(TASK_INDEX_KEY),
      ).filter((entry) => entry.id !== task.id);
      index.push({ id: task.id, nextCheckAt: task.nextCheckAt });
      index.sort(
        (left, right) =>
          left.nextCheckAt - right.nextCheckAt ||
          left.id.localeCompare(right.id),
      );
      await this.store.setCache(taskKey(task.id), task);
      await this.store.setCache(TASK_INDEX_KEY, index);

      const userKey = userTaskKey(task.userId);
      const userTasks = asIdList(await this.store.getCache(userKey));
      if (!userTasks.includes(task.id)) {
        userTasks.push(task.id);
        await this.store.setCache(userKey, userTasks);
      }
    });
  }

  async listDue(now: number, limit: number): Promise<UpdateCheckTask[]> {
    const due: UpdateCheckTask[] = [];
    const index = asTaskIndex(await this.store.getCache(TASK_INDEX_KEY));
    for (const entry of index) {
      if (entry.nextCheckAt > now) break;
      const task = await this.get(entry.id);
      if (!task) continue;
      if (task.nextCheckAt > now) continue;
      due.push(task);
      if (due.length >= Math.max(0, limit)) break;
    }
    return due;
  }

  async listTasksByUser(username: string): Promise<UpdateCheckTask[]> {
    const ids = asIdList(await this.store.getCache(userTaskKey(username)));
    const tasks = await Promise.all(ids.map((id) => this.get(id)));
    return tasks
      .filter((task): task is UpdateCheckTask => task?.userId === username)
      .sort(
        (left, right) =>
          left.nextCheckAt - right.nextCheckAt ||
          left.id.localeCompare(right.id),
      );
  }

  async listAllUsersWithTasks(): Promise<string[]> {
    const users = new Set<string>();
    const index = asTaskIndex(await this.store.getCache(TASK_INDEX_KEY));
    for (const entry of index) {
      const task = await this.get(entry.id);
      if (task) users.add(task.userId);
    }
    return [...users].sort();
  }

  async findEarliestNextCheckAt(): Promise<number | null> {
    let earliest: number | null = null;
    const index = asTaskIndex(await this.store.getCache(TASK_INDEX_KEY));
    for (const entry of index) {
      const task = await this.get(entry.id);
      if (!task) continue;
      earliest =
        earliest === null
          ? task.nextCheckAt
          : Math.min(earliest, task.nextCheckAt);
    }
    return earliest;
  }

  async batchUpdateNextCheckAt(
    username: string,
    nextCheckAt: number,
  ): Promise<number> {
    if (!Number.isFinite(nextCheckAt)) {
      throw new Error('INVALID_NEXT_CHECK_AT');
    }

    return queuedWrite(TASK_INDEX_KEY, async () => {
      const ids = asIdList(await this.store.getCache(userTaskKey(username)));
      const tasks = (await Promise.all(ids.map((id) => this.get(id)))).filter(
        (task): task is UpdateCheckTask => task?.userId === username,
      );
      if (tasks.length === 0) return 0;

      const updatedIds = new Set(tasks.map((task) => task.id));
      const index = asTaskIndex(
        await this.store.getCache(TASK_INDEX_KEY),
      ).filter((entry) => !updatedIds.has(entry.id));
      for (const task of tasks) {
        const updated = { ...task, nextCheckAt };
        await this.store.setCache(taskKey(task.id), updated);
        index.push({ id: task.id, nextCheckAt });
      }
      index.sort(
        (left, right) =>
          left.nextCheckAt - right.nextCheckAt ||
          left.id.localeCompare(right.id),
      );
      await this.store.setCache(TASK_INDEX_KEY, index);
      return tasks.length;
    });
  }

  async delete(id: string): Promise<void> {
    await queuedWrite(TASK_INDEX_KEY, async () => {
      const task = await this.get(id);
      await this.store.deleteCache(taskKey(id));
      const index = asTaskIndex(
        await this.store.getCache(TASK_INDEX_KEY),
      ).filter((item) => item.id !== id);
      await this.store.setCache(TASK_INDEX_KEY, index);
      if (task) {
        const userKey = userTaskKey(task.userId);
        const userTasks = asIdList(await this.store.getCache(userKey)).filter(
          (item) => item !== id,
        );
        if (userTasks.length > 0) await this.store.setCache(userKey, userTasks);
        else await this.store.deleteCache(userKey);
      }
    });
  }

  async deleteForUser(userId: string): Promise<void> {
    await queuedWrite(TASK_INDEX_KEY, async () => {
      const userKey = userTaskKey(userId);
      const ids = asIdList(await this.store.getCache(userKey));
      const removed = new Set(ids);
      for (const id of ids) await this.store.deleteCache(taskKey(id));
      const index = asTaskIndex(
        await this.store.getCache(TASK_INDEX_KEY),
      ).filter((entry) => !removed.has(entry.id));
      await this.store.setCache(TASK_INDEX_KEY, index);
      await this.store.deleteCache(userKey);
    });
  }
}

export function updateCheckTaskId(userId: string, followId: string): string {
  return taskId(userId, followId);
}
