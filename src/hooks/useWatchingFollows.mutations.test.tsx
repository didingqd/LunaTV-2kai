import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  deleteWatchingFollow,
  getWatchingFollows,
  postWatchingFollow,
  putWatchingFollow,
  watchingFollowKey,
} from '@/lib/api/watching-follow';
import { getAllPlayRecords } from '@/lib/db.client';
import type { PlayRecord, WatchingFollow } from '@/lib/types';

import {
  useWatchingFollows,
  watchingFollowsQueryKey,
} from './useWatchingFollows';

jest.mock('@/lib/api/watching-follow', () => {
  class WatchingFollowApiError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
    ) {
      super(message);
      this.name = 'WatchingFollowApiError';
    }
  }

  const watchingFollowKey = (source: string, id: string) => `${source}+${id}`;

  return {
    WatchingFollowApiError,
    advanceWatchingFollowOriginalEpisodes: jest.fn(),
    deleteWatchingFollow: jest.fn(),
    getWatchingFollows: jest.fn(),
    isWatchingFollowActive: (
      follows: Record<string, WatchingFollow>,
      source: string,
      id: string,
    ) => follows[watchingFollowKey(source, id)]?.enabled === true,
    postWatchingFollow: jest.fn(),
    putWatchingFollow: jest.fn(),
    watchingFollowKey,
  };
});

jest.mock('@/lib/db.client', () => ({
  getAllPlayRecords: jest.fn(),
}));

describe('useWatchingFollows mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('optimistically marks a created follow and keeps the server result on success', async () => {
    const { queryClient, wrapper } = setup();
    const input = createInput();
    const serverFollow = createFollow({ updatedAt: 2000 });
    const playRecords = deferred<Record<string, PlayRecord>>();
    const post = deferred<WatchingFollow>();
    jest.mocked(getAllPlayRecords).mockReturnValue(playRecords.promise);
    jest.mocked(postWatchingFollow).mockReturnValue(post.promise);

    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    let promise!: Promise<WatchingFollow>;
    act(() => {
      promise = result.current.createFollow(input);
    });

    await waitFor(() => {
      expect(result.current.isFollowing(input.source, input.id)).toBe(true);
    });
    expect(postWatchingFollow).not.toHaveBeenCalled();

    playRecords.resolve({
      [watchingFollowKey(input.source, input.id)]: createRecord(),
    });
    await waitFor(() => expect(postWatchingFollow).toHaveBeenCalledTimes(1));
    post.resolve(serverFollow);
    await act(async () => {
      await promise;
    });

    expect(queryClient.getQueryData(watchingFollowsQueryKey)).toEqual({
      [watchingFollowKey(input.source, input.id)]: serverFollow,
    });
  });

  it('rolls back an optimistic create when the request fails', async () => {
    const previous = createFollow({ id: 'existing' });
    const { queryClient, wrapper } = setup({
      [`${previous.source}+${previous.id}`]: previous,
    });
    const input = createInput();
    const failure = deferred<WatchingFollow>();
    jest.mocked(getAllPlayRecords).mockResolvedValue({
      [watchingFollowKey(input.source, input.id)]: createRecord(),
    });
    jest.mocked(postWatchingFollow).mockReturnValue(failure.promise);

    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    let promise!: Promise<WatchingFollow>;
    act(() => {
      promise = result.current.createFollow(input);
    });

    await waitFor(() => {
      expect(result.current.isFollowing(input.source, input.id)).toBe(true);
    });
    await act(async () => {
      failure.reject(new Error('create failed'));
      await expect(promise).rejects.toThrow('create failed');
    });

    expect(queryClient.getQueryData(watchingFollowsQueryKey)).toEqual({
      [`${previous.source}+${previous.id}`]: previous,
    });
  });

  it('optimistically removes a follow and keeps it removed on success', async () => {
    const follow = createFollow();
    const { queryClient, wrapper } = setup({
      [watchingFollowKey(follow.source, follow.id)]: follow,
    });
    const deletion = deferred<void>();
    jest.mocked(deleteWatchingFollow).mockReturnValue(deletion.promise);
    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    let promise!: Promise<void>;
    act(() => {
      promise = result.current.deleteFollow(follow.source, follow.id);
    });

    await waitFor(() => {
      expect(result.current.isFollowing(follow.source, follow.id)).toBe(false);
    });
    deletion.resolve(undefined);
    await act(async () => {
      await promise;
    });

    expect(queryClient.getQueryData(watchingFollowsQueryKey)).toEqual({});
  });

  it('rolls back an optimistic delete when the request fails', async () => {
    const follow = createFollow();
    const { queryClient, wrapper } = setup({
      [watchingFollowKey(follow.source, follow.id)]: follow,
    });
    const failure = deferred<void>();
    jest.mocked(deleteWatchingFollow).mockReturnValue(failure.promise);
    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    let promise!: Promise<void>;
    act(() => {
      promise = result.current.deleteFollow(follow.source, follow.id);
    });

    await waitFor(() => {
      expect(result.current.isFollowing(follow.source, follow.id)).toBe(false);
    });
    await act(async () => {
      failure.reject(new Error('delete failed'));
      await expect(promise).rejects.toThrow('delete failed');
    });

    expect(queryClient.getQueryData(watchingFollowsQueryKey)).toEqual({
      [watchingFollowKey(follow.source, follow.id)]: follow,
    });
  });

  it('deduplicates repeated creates for the same follow', async () => {
    const { wrapper } = setup();
    const input = createInput();
    jest.mocked(getAllPlayRecords).mockResolvedValue({
      [watchingFollowKey(input.source, input.id)]: createRecord(),
    });
    jest.mocked(postWatchingFollow).mockResolvedValue(createFollow());
    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    await act(async () => {
      await Promise.all([
        result.current.createFollow(input),
        result.current.createFollow(input),
      ]);
    });

    expect(postWatchingFollow).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated deletes for the same follow', async () => {
    const follow = createFollow();
    const { wrapper } = setup({
      [watchingFollowKey(follow.source, follow.id)]: follow,
    });
    jest.mocked(deleteWatchingFollow).mockResolvedValue(undefined);
    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    await act(async () => {
      await Promise.all([
        result.current.deleteFollow(follow.source, follow.id),
        result.current.deleteFollow(follow.source, follow.id),
      ]);
    });

    expect(deleteWatchingFollow).toHaveBeenCalledTimes(1);
  });

  it('keeps the final state deleted for create then delete', async () => {
    const { queryClient, wrapper } = setup();
    const input = createInput();
    const created = deferred<WatchingFollow>();
    const removed = deferred<void>();
    jest.mocked(getAllPlayRecords).mockResolvedValue({
      [watchingFollowKey(input.source, input.id)]: createRecord(),
    });
    jest.mocked(postWatchingFollow).mockReturnValue(created.promise);
    jest.mocked(deleteWatchingFollow).mockReturnValue(removed.promise);
    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    let createPromise!: Promise<WatchingFollow>;
    let deletePromise!: Promise<void>;
    act(() => {
      createPromise = result.current.createFollow(input);
      deletePromise = result.current.deleteFollow(input.source, input.id);
    });

    await waitFor(() => {
      expect(result.current.isFollowing(input.source, input.id)).toBe(false);
    });
    created.resolve(createFollow());
    await waitFor(() => expect(deleteWatchingFollow).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData(watchingFollowsQueryKey)).toEqual({});
    removed.resolve(undefined);
    await act(async () => {
      await Promise.all([createPromise, deletePromise]);
    });

    expect(queryClient.getQueryData(watchingFollowsQueryKey)).toEqual({});
  });

  it('keeps the final state created for delete then create', async () => {
    const follow = createFollow();
    const key = watchingFollowKey(follow.source, follow.id);
    const { queryClient, wrapper } = setup({ [key]: follow });
    const removed = deferred<void>();
    const created = deferred<WatchingFollow>();
    jest.mocked(deleteWatchingFollow).mockReturnValue(removed.promise);
    jest.mocked(getAllPlayRecords).mockResolvedValue({ [key]: createRecord() });
    jest.mocked(postWatchingFollow).mockReturnValue(created.promise);
    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    let deletePromise!: Promise<void>;
    let createPromise!: Promise<WatchingFollow>;
    act(() => {
      deletePromise = result.current.deleteFollow(follow.source, follow.id);
      createPromise = result.current.createFollow(createInput());
    });

    await waitFor(() => {
      expect(result.current.isFollowing(follow.source, follow.id)).toBe(true);
    });
    removed.resolve(undefined);
    await waitFor(() => expect(postWatchingFollow).toHaveBeenCalledTimes(1));
    created.resolve(createFollow({ updatedAt: 3000 }));
    await act(async () => {
      await Promise.all([deletePromise, createPromise]);
    });

    expect(queryClient.getQueryData(watchingFollowsQueryKey)).toEqual({
      [key]: createFollow({ updatedAt: 3000 }),
    });
  });

  it('coordinates multiple hook instances for the same follow', async () => {
    const { wrapper } = setup();
    const input = createInput();
    const server = deferred<WatchingFollow>();
    jest.mocked(getAllPlayRecords).mockResolvedValue({
      [watchingFollowKey(input.source, input.id)]: createRecord(),
    });
    jest.mocked(postWatchingFollow).mockReturnValue(server.promise);
    const first = renderHook(() => useWatchingFollows(), { wrapper });
    const second = renderHook(() => useWatchingFollows(), { wrapper });

    let firstPromise!: Promise<WatchingFollow>;
    let secondPromise!: Promise<WatchingFollow>;
    act(() => {
      firstPromise = first.result.current.createFollow(input);
      secondPromise = second.result.current.createFollow(input);
    });

    await waitFor(() => {
      expect(first.result.current.isFollowPending(input.source, input.id)).toBe(
        true,
      );
      expect(
        second.result.current.isFollowPending(input.source, input.id),
      ).toBe(true);
    });
    server.resolve(createFollow());
    await act(async () => {
      await Promise.all([firstPromise, secondPromise]);
    });

    expect(postWatchingFollow).toHaveBeenCalledTimes(1);
    expect(first.result.current.isFollowPending(input.source, input.id)).toBe(
      false,
    );
    expect(second.result.current.isFollowPending(input.source, input.id)).toBe(
      false,
    );
  });

  it('marks watchingUpdates stale without immediately refetching active queries', async () => {
    const { queryClient, wrapper } = setup();
    const input = createInput();
    const updatesQueryFn = jest.fn(async () => ({ updatedSeries: [] }));
    jest.mocked(getAllPlayRecords).mockResolvedValue({
      [watchingFollowKey(input.source, input.id)]: createRecord(),
    });
    jest.mocked(postWatchingFollow).mockResolvedValue(createFollow());
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => {
        useQuery({ queryKey: ['watchingUpdates'], queryFn: updatesQueryFn });
        return useWatchingFollows();
      },
      { wrapper },
    );

    await waitFor(() => expect(updatesQueryFn).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.createFollow(input);
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['watchingUpdates'],
      refetchType: 'none',
    });
    expect(updatesQueryFn).toHaveBeenCalledTimes(1);
  });

  it('does not let an older create response overwrite a later delete intent', async () => {
    const { queryClient, wrapper } = setup();
    const input = createInput();
    const created = deferred<WatchingFollow>();
    const removed = deferred<void>();
    jest.mocked(getAllPlayRecords).mockResolvedValue({
      [watchingFollowKey(input.source, input.id)]: createRecord(),
    });
    jest.mocked(postWatchingFollow).mockReturnValue(created.promise);
    jest.mocked(deleteWatchingFollow).mockReturnValue(removed.promise);
    const { result } = renderHook(() => useWatchingFollows(), { wrapper });

    let createPromise!: Promise<WatchingFollow>;
    let deletePromise!: Promise<void>;
    act(() => {
      createPromise = result.current.createFollow(input);
      deletePromise = result.current.deleteFollow(input.source, input.id);
    });
    created.resolve(createFollow({ updatedAt: 9000 }));
    await waitFor(() => expect(deleteWatchingFollow).toHaveBeenCalledTimes(1));

    expect(queryClient.getQueryData(watchingFollowsQueryKey)).toEqual({});
    removed.resolve(undefined);
    await act(async () => {
      await Promise.all([createPromise, deletePromise]);
    });
  });
});

function setup(initialFollows: Record<string, WatchingFollow> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  queryClient.setQueryData(watchingFollowsQueryKey, initialFollows);
  jest
    .mocked(getWatchingFollows)
    .mockImplementation(
      async () => queryClient.getQueryData(watchingFollowsQueryKey) ?? {},
    );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function createInput() {
  return {
    source: 'source-a',
    id: 'video-1',
    title: 'Demo',
    cover: 'cover.jpg',
    year: '2026',
    type: 'tv',
    originalEpisodes: 12,
  };
}

function createFollow(overrides: Partial<WatchingFollow> = {}): WatchingFollow {
  return {
    source: 'source-a',
    id: 'video-1',
    title: 'Demo',
    cover: 'cover.jpg',
    year: '2026',
    type: 'tv',
    originalEpisodes: 12,
    createdAt: 1000,
    updatedAt: 1000,
    enabled: true,
    ...overrides,
  };
}

function createRecord(): PlayRecord {
  return {
    title: 'Demo',
    source_name: 'Source A',
    cover: 'cover.jpg',
    year: '2026',
    index: 1,
    total_episodes: 12,
    play_time: 0,
    total_time: 100,
    save_time: 1000,
    search_title: 'Demo',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
