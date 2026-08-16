'use client';

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useState } from 'react';

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

const activeCreateOperations = new Map<string, Promise<WatchingFollow>>();

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
      const active = activeCreateOperations.get(key);
      if (active) return active;

      const operation = (async () => {
        const currentFollows = await queryClient.fetchQuery({
          ...watchingFollowsQueryOptions,
          staleTime: 0,
        });
        const current = currentFollows[key];
        if (current?.enabled) return current;

        const playRecords = await getAllPlayRecords(true);
        if (!playRecords[key]) {
          throw new WatchingFollowApiError(
            'A PlayRecord is required before creating a WatchingFollow',
            409,
          );
        }
        if (current) {
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
      })();

      activeCreateOperations.set(key, operation);
      try {
        return await operation;
      } finally {
        activeCreateOperations.delete(key);
      }
    },
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
      void queryClient.invalidateQueries({ queryKey: watchingFollowsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['watchingUpdates'] });
    },
  });
}

export function useDeleteWatchingFollowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ source, id }: { source: string; id: string }) =>
      deleteWatchingFollow(source, id),
    onMutate: async ({ source, id }) => {
      await queryClient.cancelQueries({ queryKey: watchingFollowsQueryKey });
      const previous = queryClient.getQueryData<Record<string, WatchingFollow>>(
        watchingFollowsQueryKey,
      );
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
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(watchingFollowsQueryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: watchingFollowsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['watchingUpdates'] });
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
      void queryClient.invalidateQueries({ queryKey: ['watchingUpdates'] });
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
  const [pendingFollowKeys, setPendingFollowKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const list = Object.values(query.data ?? {})
    .filter((follow) => follow.enabled)
    .sort((a, b) => b.createdAt - a.createdAt);

  const setFollowPending = useCallback(
    (source: string, id: string, pending: boolean) => {
      const key = watchingFollowKey(source, id);
      setPendingFollowKeys((current) => {
        if (pending && current.has(key)) return current;
        if (!pending && !current.has(key)) return current;

        const next = new Set(current);
        if (pending) next.add(key);
        else next.delete(key);
        return next;
      });
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
    (source: string, id: string) =>
      pendingFollowKeys.has(watchingFollowKey(source, id)),
    [pendingFollowKeys],
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

export type { CreateWatchingFollowInput };
