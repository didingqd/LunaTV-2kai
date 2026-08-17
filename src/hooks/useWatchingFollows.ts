'use client';

import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import {
  advanceWatchingFollowOriginalEpisodes,
  deleteWatchingFollow,
  getWatchingFollows,
  isWatchingFollowActive,
  postWatchingFollow,
  putWatchingFollow,
  WatchingFollowApiError,
  type CreateWatchingFollowInput,
  watchingFollowKey,
} from '@/lib/api/watching-follow';
import { compareContentIdentity } from '@/lib/content-identity';
import { getAllPlayRecords } from '@/lib/db.client';
import type { WatchingFollow } from '@/lib/types';

export const watchingFollowsQueryKey = ['watchingFollows'] as const;

type FollowOperationKind = 'create' | 'delete';

type FollowIntent = {
  kind: FollowOperationKind;
  version: number;
};

type FollowMutationContext = FollowIntent & {
  key: string;
  previous: Record<string, WatchingFollow>;
};

const activeFollowOperations = new Map<
  string,
  { kind: FollowOperationKind; promise: Promise<unknown> }
>();
const followOperationTails = new Map<string, Promise<unknown>>();
const latestFollowIntents = new Map<string, FollowIntent>();
const rollbackSnapshots = new Map<string, Record<string, WatchingFollow>>();
const pendingFollowCounts = new Map<string, number>();
const pendingFollowListeners = new Set<() => void>();
let followIntentVersion = 0;
let pendingFollowSnapshotVersion = 0;

function nextFollowIntent(
  key: string,
  kind: FollowOperationKind,
): FollowIntent {
  const intent = { kind, version: ++followIntentVersion };
  latestFollowIntents.set(key, intent);
  return intent;
}

function isLatestFollowIntent(context?: FollowMutationContext): boolean {
  if (!context) return false;
  const latest = latestFollowIntents.get(context.key);
  return latest?.kind === context.kind && latest.version === context.version;
}

function operationSnapshotKey(key: string, kind: FollowOperationKind): string {
  return `${kind}:${key}`;
}

function getRollbackSnapshot(
  key: string,
  kind: FollowOperationKind,
  previous?: Record<string, WatchingFollow>,
) {
  const snapshotKey = operationSnapshotKey(key, kind);
  const existing = rollbackSnapshots.get(snapshotKey);
  if (existing) return existing;
  const snapshot = previous ? { ...previous } : {};
  rollbackSnapshots.set(snapshotKey, snapshot);
  return snapshot;
}

function clearRollbackSnapshot(key: string, kind: FollowOperationKind) {
  rollbackSnapshots.delete(operationSnapshotKey(key, kind));
}

function runFollowOperation<T>(
  key: string,
  kind: FollowOperationKind,
  operation: (queuedBehindAnotherOperation: boolean) => Promise<T>,
): Promise<T> {
  const active = activeFollowOperations.get(key);
  if (active?.kind === kind) return active.promise as Promise<T>;

  const previous = followOperationTails.get(key);
  const queuedBehindAnotherOperation = previous !== undefined;
  const waitForPrevious = previous?.catch(() => undefined) ?? Promise.resolve();
  const promise = waitForPrevious.then(() =>
    operation(queuedBehindAnotherOperation),
  );
  const tail = promise.catch(() => undefined);

  activeFollowOperations.set(key, { kind, promise });
  followOperationTails.set(key, tail);

  void promise
    .finally(() => {
      const current = activeFollowOperations.get(key);
      if (current?.promise === promise) activeFollowOperations.delete(key);
      if (followOperationTails.get(key) === tail)
        followOperationTails.delete(key);
      clearRollbackSnapshot(key, kind);
    })
    .catch(() => undefined);

  return promise;
}

function subscribePendingFollows(listener: () => void) {
  pendingFollowListeners.add(listener);
  return () => {
    pendingFollowListeners.delete(listener);
  };
}

function emitPendingFollowChange() {
  pendingFollowSnapshotVersion += 1;
  pendingFollowListeners.forEach((listener) => listener());
}

function getPendingFollowSnapshot() {
  return pendingFollowSnapshotVersion;
}

function setGlobalFollowPending(source: string, id: string, pending: boolean) {
  const key = watchingFollowKey(source, id);
  const current = pendingFollowCounts.get(key) ?? 0;
  const next = pending ? current + 1 : Math.max(0, current - 1);

  if (next === current) return;
  if (next === 0) pendingFollowCounts.delete(key);
  else pendingFollowCounts.set(key, next);
  emitPendingFollowChange();
}

function isGlobalFollowPending(source: string, id: string): boolean {
  return pendingFollowCounts.has(watchingFollowKey(source, id));
}

function createOptimisticWatchingFollow(
  input: CreateWatchingFollowInput,
  previous?: Record<string, WatchingFollow>,
): WatchingFollow {
  const existing = previous?.[watchingFollowKey(input.source, input.id)];
  const now = Date.now();
  return {
    source: input.source,
    id: input.id,
    title: input.title,
    cover: input.cover,
    year: input.year,
    type: input.type,
    originalEpisodes: input.originalEpisodes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    enabled: input.enabled ?? true,
  };
}

function invalidateWatchingUpdatesWithoutRefetch(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: ['watchingUpdates'],
    refetchType: 'none',
  });
}

export const watchingFollowsQueryOptions = queryOptions({
  queryKey: watchingFollowsQueryKey,
  queryFn: getWatchingFollows,
  staleTime: 60 * 1000,
  gcTime: 10 * 60 * 1000,
  retry: 1,
});

export function useWatchingFollowsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    ...watchingFollowsQueryOptions,
    enabled: options?.enabled,
  });
}

export function useWatchingFollowsArrayQuery(options?: { enabled?: boolean }) {
  return useQuery({
    ...watchingFollowsQueryOptions,
    select: (follows) =>
      Object.values(follows)
        .filter((follow) => follow.enabled)
        .sort((a, b) => b.createdAt - a.createdAt),
    enabled: options?.enabled,
  });
}

export function useIsWatchingFollowQuery(
  source: string,
  id: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...watchingFollowsQueryOptions,
    select: (follows) =>
      Object.values(follows).some(
        (follow) =>
          follow.enabled && compareContentIdentity(follow, { source, id }),
      ),
    enabled: (options?.enabled ?? true) && !!source && !!id,
  });
}

export function useCreateWatchingFollowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWatchingFollowInput) => {
      const key = watchingFollowKey(input.source, input.id);
      return runFollowOperation(key, 'create', async (queued) => {
        const playRecords = await getAllPlayRecords(true);
        if (!playRecords[key]) {
          throw new WatchingFollowApiError(
            'A PlayRecord is required before creating a WatchingFollow',
            409,
          );
        }

        const currentFollows =
          rollbackSnapshots.get(operationSnapshotKey(key, 'create')) ??
          queryClient.getQueryData<Record<string, WatchingFollow>>(
            watchingFollowsQueryKey,
          ) ??
          {};
        const current = currentFollows[key];
        if (!queued && current?.enabled) return current;
        if (!queued && current) {
          return putWatchingFollow(input.source, input.id, { enabled: true });
        }

        try {
          return await postWatchingFollow(input);
        } catch (error) {
          if (error instanceof WatchingFollowApiError && error.status === 409) {
            const fresh = await getWatchingFollows();
            const existing = fresh[key];
            if (existing?.enabled) return existing;
            if (existing) {
              return putWatchingFollow(input.source, input.id, {
                enabled: true,
              });
            }
          }
          throw error;
        }
      });
    },
    onMutate: async (input) => {
      const key = watchingFollowKey(input.source, input.id);
      const intent = nextFollowIntent(key, 'create');

      await queryClient.cancelQueries({ queryKey: watchingFollowsQueryKey });
      const previous = queryClient.getQueryData<Record<string, WatchingFollow>>(
        watchingFollowsQueryKey,
      );
      const rollback = getRollbackSnapshot(key, 'create', previous);
      const optimistic = createOptimisticWatchingFollow(input, rollback);

      queryClient.setQueryData<Record<string, WatchingFollow>>(
        watchingFollowsQueryKey,
        (current = {}) => ({
          ...current,
          [key]: optimistic,
        }),
      );

      return { key, kind: 'create' as const, ...intent, previous: rollback };
    },
    onSuccess: (follow, _variables, context) => {
      if (!isLatestFollowIntent(context)) return;
      queryClient.setQueryData<Record<string, WatchingFollow>>(
        watchingFollowsQueryKey,
        (previous = {}) => ({
          ...previous,
          [watchingFollowKey(follow.source, follow.id)]: follow,
        }),
      );
    },
    onError: (_error, _variables, context) => {
      if (!isLatestFollowIntent(context)) return;
      queryClient.setQueryData(watchingFollowsQueryKey, context.previous);
    },
    onSettled: (_data, _error, _variables, context) => {
      if (!isLatestFollowIntent(context)) return;
      void queryClient.invalidateQueries({ queryKey: watchingFollowsQueryKey });
      invalidateWatchingUpdatesWithoutRefetch(queryClient);
    },
  });
}

export function useDeleteWatchingFollowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ source, id }: { source: string; id: string }) =>
      runFollowOperation(watchingFollowKey(source, id), 'delete', () =>
        deleteWatchingFollow(source, id),
      ),
    onMutate: async ({ source, id }) => {
      const key = watchingFollowKey(source, id);
      const intent = nextFollowIntent(key, 'delete');

      await queryClient.cancelQueries({ queryKey: watchingFollowsQueryKey });
      const previous = queryClient.getQueryData<Record<string, WatchingFollow>>(
        watchingFollowsQueryKey,
      );
      const rollback = getRollbackSnapshot(key, 'delete', previous);
      queryClient.setQueryData<Record<string, WatchingFollow>>(
        watchingFollowsQueryKey,
        (current = {}) => {
          const next = { ...current };
          for (const [key, follow] of Object.entries(next)) {
            if (compareContentIdentity(follow, { source, id }))
              delete next[key];
          }
          return next;
        },
      );
      return { key, kind: 'delete' as const, ...intent, previous: rollback };
    },
    onError: (_error, _variables, context) => {
      if (!isLatestFollowIntent(context)) return;
      queryClient.setQueryData(watchingFollowsQueryKey, context.previous);
    },
    onSettled: (_data, _error, _variables, context) => {
      if (!isLatestFollowIntent(context)) return;
      void queryClient.invalidateQueries({ queryKey: watchingFollowsQueryKey });
      invalidateWatchingUpdatesWithoutRefetch(queryClient);
    },
  });
}

export function useAdvanceWatchingFollowOriginalEpisodesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      source,
      id,
      confirmedEpisode,
    }: {
      source: string;
      id: string;
      confirmedEpisode: number;
    }) => advanceWatchingFollowOriginalEpisodes(source, id, confirmedEpisode),
    onSuccess: (follow) => {
      queryClient.setQueryData<Record<string, WatchingFollow>>(
        watchingFollowsQueryKey,
        (previous = {}) => ({
          ...previous,
          [watchingFollowKey(follow.source, follow.id)]: follow,
        }),
      );
    },
    onSettled: () => {
      // A manual baseline confirmation changes only WatchingFollow state, but
      // NEW/+N, update reminders and Continue Watching badges all derive from
      // Watching Updates, so invalidate both caches together.
      void queryClient.invalidateQueries({ queryKey: watchingFollowsQueryKey });
      invalidateWatchingUpdatesWithoutRefetch(queryClient);
    },
  });
}

export function useRefreshWatchingFollows() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.refetchQueries({
      queryKey: watchingFollowsQueryKey,
      type: 'active',
    });
}

export function useWatchingFollows(options?: { enabled?: boolean }) {
  const query = useWatchingFollowsQuery(options);
  const createMutation = useCreateWatchingFollowMutation();
  const deleteMutation = useDeleteWatchingFollowMutation();
  const advanceOriginalEpisodesMutation =
    useAdvanceWatchingFollowOriginalEpisodesMutation();
  const refresh = useRefreshWatchingFollows();
  const pendingSnapshot = useSyncExternalStore(
    subscribePendingFollows,
    getPendingFollowSnapshot,
    getPendingFollowSnapshot,
  );
  const list = Object.values(query.data ?? {})
    .filter((follow) => follow.enabled)
    .sort((a, b) => b.createdAt - a.createdAt);

  const setFollowPending = useCallback(
    (source: string, id: string, pending: boolean) => {
      setGlobalFollowPending(source, id, pending);
    },
    [],
  );

  const createFollow = useCallback(
    async (input: CreateWatchingFollowInput) => {
      setFollowPending(input.source, input.id, true);
      try {
        return await createMutation.mutateAsync(input);
      } finally {
        setFollowPending(input.source, input.id, false);
      }
    },
    [createMutation, setFollowPending],
  );

  const deleteFollow = useCallback(
    async (source: string, id: string) => {
      setFollowPending(source, id, true);
      try {
        return await deleteMutation.mutateAsync({ source, id });
      } finally {
        setFollowPending(source, id, false);
      }
    },
    [deleteMutation, setFollowPending],
  );

  const confirmWatchedToLatest = useCallback(
    async (source: string, id: string, latestEpisode: number) => {
      setFollowPending(source, id, true);
      try {
        return await advanceOriginalEpisodesMutation.mutateAsync({
          source,
          id,
          confirmedEpisode: latestEpisode,
        });
      } finally {
        setFollowPending(source, id, false);
      }
    },
    [advanceOriginalEpisodesMutation, setFollowPending],
  );

  const isFollowPending = useCallback(
    (source: string, id: string) => isGlobalFollowPending(source, id),
    [pendingSnapshot],
  );

  return {
    list,
    follows: query.data ?? {},
    isLoading: query.isLoading,
    isStateKnown: query.data !== undefined,
    error: query.error,
    isFollowing: (source: string, id: string) =>
      isWatchingFollowActive(query.data ?? {}, source, id),
    createFollow,
    deleteFollow,
    confirmWatchedToLatest,
    isFollowPending,
    refresh,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

export type WatchingFollowBaselineMenuState = {
  title: string;
  isAlreadyAtLatest: boolean;
};

// Continue Watching 只需要一个纯展示状态：它不保存新字段，也不修改
// baseline，只把 existing originalEpisodes 和 latestEpisodes 的关系翻译成
// 菜单标题/图标语义。
export function getWatchingFollowBaselineMenuState(
  follows: Record<string, WatchingFollow>,
  source: string,
  id: string,
  latestEpisodes: number,
): WatchingFollowBaselineMenuState | null {
  const normalizedLatest = Number.isFinite(latestEpisodes)
    ? Math.floor(latestEpisodes)
    : 0;
  if (!source || !id || normalizedLatest <= 0) return null;

  const follow = Object.values(follows).find(
    (item) => item.enabled && compareContentIdentity(item, { source, id }),
  );
  if (!follow) return null;

  const isAlreadyAtLatest = follow.originalEpisodes >= normalizedLatest;
  return {
    title: isAlreadyAtLatest ? '已观看至最新' : '标记为看至最新',
    isAlreadyAtLatest,
  };
}

export type { CreateWatchingFollowInput };
