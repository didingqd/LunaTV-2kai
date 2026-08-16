/** @jest-environment node */

import { NextRequest } from 'next/server';

import { playRecordStorageKey } from '@/lib/play-record';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(() => ({ username: 'alice' })),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(async () => ({
    UserConfig: { Users: [{ username: 'alice', banned: false }] },
  })),
}));

jest.mock('@/lib/db', () => ({
  db: {
    deletePlayRecord: jest.fn(),
    deleteWatchingFollow: jest.fn(),
    getAllPlayRecords: jest.fn(),
    getAllWatchingFollows: jest.fn(),
    getPlayRecord: jest.fn(),
    getWatchingFollow: jest.fn(),
    savePlayRecord: jest.fn(),
    advanceWatchingFollowOriginalEpisodes: jest.fn(),
    isStatsSupported: jest.fn(() => false),
    updatePlayStatistics: jest.fn(),
  },
}));

jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: {
    onFollowDeleted: jest.fn(),
    refreshResultAfterBaselineAdvance: jest.fn(),
  },
}));

jest.mock('@/lib/watch-completion-threshold-preference', () => ({
  watchCompletionThresholdPreference: {
    getWatchCompletionThreshold: jest.fn(async () => 80),
  },
}));

jest.mock('@/lib/performance-monitor', () => ({
  getDbQueryCount: jest.fn(() => 0),
  recordRequest: jest.fn(),
  resetDbQueryCount: jest.fn(),
}));

import { DELETE, POST } from './route';
import { db } from '@/lib/db';
import { updateCheckService } from '@/lib/update-check-service';

const mockDeletePlayRecord = db.deletePlayRecord as jest.Mock;
const mockDeleteWatchingFollow = db.deleteWatchingFollow as jest.Mock;
const mockGetAllPlayRecords = db.getAllPlayRecords as jest.Mock;
const mockGetAllWatchingFollows = db.getAllWatchingFollows as jest.Mock;
const mockGetPlayRecord = db.getPlayRecord as jest.Mock;
const mockGetWatchingFollow = db.getWatchingFollow as jest.Mock;
const mockSavePlayRecord = db.savePlayRecord as jest.Mock;
const mockAdvanceOriginalEpisodes =
  db.advanceWatchingFollowOriginalEpisodes as jest.Mock;
const mockOnFollowDeleted = updateCheckService.onFollowDeleted as jest.Mock;
const mockRefreshAfterBaselineAdvance =
  updateCheckService.refreshResultAfterBaselineAdvance as jest.Mock;

describe('PlayRecord POST follow baseline lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPlayRecord.mockResolvedValue(null);
    mockSavePlayRecord.mockResolvedValue(undefined);
    mockGetWatchingFollow.mockResolvedValue({
      source: 'source-a',
      id: 'video+1',
      enabled: true,
      originalEpisodes: 2,
    });
    mockAdvanceOriginalEpisodes.mockResolvedValue({
      found: true,
      changed: true,
      previousEpisodes: 2,
      originalEpisodes: 8,
      follow: {
        source: 'source-a',
        id: 'video+1',
        enabled: true,
        originalEpisodes: 8,
      },
    });
  });

  it('advances WatchingFollow originalEpisodes when saved playback reaches completion', async () => {
    const response = await POST(
      postRequest({
        index: 8,
        total_episodes: 8,
        play_time: 90,
        total_time: 100,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSavePlayRecord).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
      expect.objectContaining({
        index: 8,
        play_time: 90,
        total_time: 100,
      }),
    );
    expect(mockAdvanceOriginalEpisodes).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
      8,
    );
    expect(mockRefreshAfterBaselineAdvance).toHaveBeenCalledWith({
      userId: 'alice',
      source: 'source-a',
      resourceId: 'video+1',
      latestEpisode: 8,
    });
  });

  it('does not rewrite PlayRecord to the latest episode during baseline advancement', async () => {
    await POST(
      postRequest({
        index: 2,
        total_episodes: 8,
        play_time: 90,
        total_time: 100,
      }),
    );

    expect(mockSavePlayRecord).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
      expect.objectContaining({
        index: 2,
        total_episodes: 8,
        play_time: 90,
      }),
    );
    expect(mockAdvanceOriginalEpisodes).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
      2,
    );
  });

  it('keeps monotonic protection when an old playback save follows a higher baseline', async () => {
    mockAdvanceOriginalEpisodes.mockResolvedValueOnce({
      found: true,
      changed: false,
      previousEpisodes: 8,
      originalEpisodes: 8,
      follow: {
        source: 'source-a',
        id: 'video+1',
        enabled: true,
        originalEpisodes: 8,
      },
    });

    await POST(
      postRequest({
        index: 2,
        total_episodes: 8,
        play_time: 90,
        total_time: 100,
      }),
    );

    expect(mockAdvanceOriginalEpisodes).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
      2,
    );
    expect(mockRefreshAfterBaselineAdvance).not.toHaveBeenCalled();
  });
});

describe('PlayRecord DELETE lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeletePlayRecord.mockResolvedValue(undefined);
    mockDeleteWatchingFollow.mockResolvedValue(undefined);
  });

  it('deletes the matching Follow after deleting one PlayRecord by default', async () => {
    const key = playRecordStorageKey('source-a', 'video+1');
    const request = new NextRequest(
      `http://localhost/api/playrecords?key=${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );

    const response = await DELETE(request);

    expect(response.status).toBe(200);
    expect(mockDeletePlayRecord).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
    );
    expect(mockDeleteWatchingFollow).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
    );
    expect(mockOnFollowDeleted).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
    );
  });

  it('can explicitly block cascade for guarded internal callers', async () => {
    const key = playRecordStorageKey('source-a', 'video+1');
    const request = new NextRequest(
      `http://localhost/api/playrecords?key=${encodeURIComponent(key)}&cascade=none`,
      { method: 'DELETE' },
    );

    const response = await DELETE(request);

    expect(response.status).toBe(200);
    expect(mockDeletePlayRecord).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video+1',
    );
    expect(mockDeleteWatchingFollow).not.toHaveBeenCalled();
    expect(mockOnFollowDeleted).not.toHaveBeenCalled();
  });

  it('clears WatchingFollows when all PlayRecords are cleared by default', async () => {
    mockGetAllPlayRecords.mockResolvedValue({
      [playRecordStorageKey('source-a', 'video-1')]: { index: 1 },
      [playRecordStorageKey('source-b', 'video-2')]: { index: 2 },
    });
    mockGetAllWatchingFollows.mockResolvedValue({
      first: { source: 'source-a', id: 'video-1' },
      second: { source: 'source-b', id: 'video-2' },
    });

    const response = await DELETE(
      new NextRequest('http://localhost/api/playrecords', {
        method: 'DELETE',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockDeletePlayRecord).toHaveBeenCalledTimes(2);
    expect(mockDeleteWatchingFollow).toHaveBeenCalledTimes(2);
    expect(mockOnFollowDeleted).toHaveBeenCalledTimes(2);
  });

  it('can clear only PlayRecords when cascade is explicitly blocked', async () => {
    mockGetAllPlayRecords.mockResolvedValue({
      [playRecordStorageKey('source-a', 'video-1')]: { index: 1 },
      [playRecordStorageKey('source-b', 'video-2')]: { index: 2 },
    });
    mockGetAllWatchingFollows.mockResolvedValue({
      first: { source: 'source-a', id: 'video-1' },
      second: { source: 'source-b', id: 'video-2' },
    });

    const response = await DELETE(
      new NextRequest('http://localhost/api/playrecords?cascade=none', {
        method: 'DELETE',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockDeletePlayRecord).toHaveBeenCalledTimes(2);
    expect(mockDeleteWatchingFollow).not.toHaveBeenCalled();
    expect(mockOnFollowDeleted).not.toHaveBeenCalled();
  });
});

function postRequest(recordOverrides: Partial<Record<string, unknown>>) {
  const key = playRecordStorageKey('source-a', 'video+1');
  return new NextRequest('http://localhost/api/playrecords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key,
      record: {
        title: 'Demo',
        source_name: 'Source A',
        cover: '',
        year: '2026',
        index: 1,
        total_episodes: 8,
        play_time: 1,
        total_time: 100,
        save_time: 1000,
        search_title: 'Demo',
        ...recordOverrides,
      },
    }),
  });
}
