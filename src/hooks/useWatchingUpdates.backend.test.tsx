import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { watchingFollowKey } from '@/lib/api/watching-follow';
import { playRecordStorageKey } from '@/lib/play-record';
import type { PlayRecord, WatchingFollow } from '@/lib/types';
import { writeWatchingUpdateSourceMode } from '@/lib/watching-update-preference';
import type { WatchingUpdate } from '@/lib/watching-update-result';
import { watchingUpdatesService } from '@/lib/watching-updates-service';

import { useWatchingUpdatesQuery } from './useWatchingUpdates';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(() => ({ username: 'alice' })),
}));
jest.mock('@/lib/api/watching-follow', () => ({
  ...jest.requireActual('@/lib/api/watching-follow'),
  isLocalWatchingFollowMode: jest.fn(() => false),
}));
jest.mock('@/lib/watching-updates-service', () => ({
  watchingUpdatesService: {
    resolveMode: jest.fn(),
    getBackendResults: jest.fn(),
    syncObservations: jest.fn(),
  },
}));

const service = jest.mocked(watchingUpdatesService);

describe('useWatchingUpdates backend adaptation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    service.syncObservations.mockResolvedValue(undefined);
    global.fetch = jest.fn(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/detail')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Local Demo',
            cover: 'cover.jpg',
            year: '2026',
            episodes: Array.from({ length: 12 }, (_, index) => index + 1),
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps default local mode on the existing calculation path', async () => {
    const { result } = renderUpdatesHook();

    await waitFor(() => expect(result.current.data?.updatedCount).toBe(1));
    expect(result.current.sourceMode).toBe('local');
    expect(result.current.effectiveSourceMode).toBe('local');
    expect(service.resolveMode).not.toHaveBeenCalled();
    expect(service.getBackendResults).not.toHaveBeenCalled();
    expect(service.syncObservations).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/detail'),
      { cache: 'no-store' },
    );
  });

  it('shows backend results first and uploads only Observation fields', async () => {
    writeWatchingUpdateSourceMode('backend', window.localStorage);
    service.resolveMode.mockResolvedValue({
      requestedMode: 'backend',
      effectiveMode: 'backend',
      capabilityState: 'available',
      capability: {
        supported: true,
        enabled: true,
        userAllowed: true,
        mode: 'backend',
      },
    });
    service.getBackendResults.mockResolvedValue({
      data: backendUpdate(),
      freshness: 'fresh',
    });

    const { result } = renderUpdatesHook();

    await waitFor(() =>
      expect(result.current.data?.updatedSeries[0]?.title).toBe('Server Demo'),
    );
    await waitFor(() => expect(service.syncObservations).toHaveBeenCalled());
    const observation = service.syncObservations.mock.calls[0][0][0];
    expect(observation).toMatchObject({
      followId: watchingFollowKey('source-a', 'video-1'),
      source: 'source-a',
      resourceId: 'video-1',
      latestEpisode: 12,
      clientId: 'web',
    });
    expect(Object.keys(observation)).not.toEqual(
      expect.arrayContaining([
        'unwatchedCount',
        'hasUpdate',
        'newEpisodes',
        'remainingEpisodes',
        'baselineEpisode',
      ]),
    );
    expect(result.current.effectiveSourceMode).toBe('backend');
  });

  it('falls back to local when capability fails', async () => {
    writeWatchingUpdateSourceMode('backend', window.localStorage);
    service.resolveMode.mockResolvedValue({
      requestedMode: 'backend',
      effectiveMode: 'local',
      capabilityState: 'error',
    });

    const { result } = renderUpdatesHook();

    await waitFor(() => expect(result.current.data?.updatedCount).toBe(1));
    expect(result.current.effectiveSourceMode).toBe('local');
    expect(result.current.capabilityState).toBe('error');
    expect(service.getBackendResults).not.toHaveBeenCalled();
  });

  it('does not request results when the user is not authorized', async () => {
    writeWatchingUpdateSourceMode('backend', window.localStorage);
    service.resolveMode.mockResolvedValue({
      requestedMode: 'backend',
      effectiveMode: 'local',
      capabilityState: 'unavailable',
      capability: {
        supported: true,
        enabled: true,
        userAllowed: false,
        mode: 'local',
      },
    });

    const { result } = renderUpdatesHook();

    await waitFor(() => expect(result.current.data?.updatedCount).toBe(1));
    expect(service.getBackendResults).not.toHaveBeenCalled();
    expect(service.syncObservations).not.toHaveBeenCalled();
  });

  it('falls back to local when results fail', async () => {
    writeWatchingUpdateSourceMode('backend', window.localStorage);
    allowBackend();
    service.getBackendResults.mockRejectedValue(new Error('network error'));

    const { result } = renderUpdatesHook();

    await waitFor(() => expect(result.current.data?.updatedCount).toBe(1));
    expect(result.current.effectiveSourceMode).toBe('local');
    expect(result.current.freshness).toBe('error');
  });

  it('keeps the backend result visible when Observation sync fails', async () => {
    writeWatchingUpdateSourceMode('backend', window.localStorage);
    allowBackend();
    service.getBackendResults.mockResolvedValue({
      data: backendUpdate(),
      freshness: 'fresh',
    });
    service.syncObservations.mockRejectedValue(new Error('sync failed'));

    const { result } = renderUpdatesHook();

    await waitFor(() => expect(result.current.syncState).toBe('error'));
    expect(result.current.data?.updatedSeries[0]?.title).toBe('Server Demo');
    expect(result.current.effectiveSourceMode).toBe('backend');
  });
});

function allowBackend() {
  service.resolveMode.mockResolvedValue({
    requestedMode: 'backend',
    effectiveMode: 'backend',
    capabilityState: 'available',
    capability: {
      supported: true,
      enabled: true,
      userAllowed: true,
      mode: 'backend',
    },
  });
}

function renderUpdatesHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const follow = createFollow();
  const recordKey = playRecordStorageKey('source-a', 'video-1');
  queryClient.setQueryData(['watchingFollows'], {
    [watchingFollowKey('source-a', 'video-1')]: follow,
  });
  queryClient.setQueryData(
    ['playRecords', 'array'],
    [{ ...createRecord(), key: recordKey }],
  );
  queryClient.setQueryData(
    ['sources', 'map'],
    new Map([
      ['source-a', 'source-a'],
      ['Source A', 'source-a'],
    ]),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useWatchingUpdatesQuery(), { wrapper });
}

function createFollow(): WatchingFollow {
  return {
    source: 'source-a',
    id: 'video-1',
    title: 'Local Demo',
    cover: 'cover.jpg',
    year: '2026',
    type: 'tv',
    originalEpisodes: 10,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createRecord(): PlayRecord {
  return {
    title: 'Local Demo',
    source_name: 'Source A',
    cover: 'cover.jpg',
    year: '2026',
    index: 7,
    total_episodes: 10,
    play_time: 1200,
    total_time: 1200,
    save_time: 1,
    search_title: 'Local Demo',
  };
}

function backendUpdate(): WatchingUpdate {
  return {
    hasUpdates: true,
    timestamp: 2000,
    updatedCount: 1,
    continueWatchingCount: 0,
    newReleasesCount: 0,
    updatedSeries: [
      {
        title: 'Server Demo',
        sourceName: 'Source A',
        source_name: 'Source A',
        year: '2026',
        cover: 'cover.jpg',
        identityKey: watchingFollowKey('source-a', 'video-1'),
        source: 'source-a',
        id: 'video-1',
        sourceKey: 'source-a',
        videoId: 'video-1',
        currentEpisode: 8,
        totalEpisodes: 12,
        hasNewEpisode: true,
        hasContinueWatching: false,
        hasNewRelease: false,
        newEpisodes: 2,
        remainingEpisodes: 4,
        releasedEpisodes: 2,
        unwatchedEpisodes: 4,
        latestEpisodes: 12,
        completed: false,
      },
    ],
  };
}
