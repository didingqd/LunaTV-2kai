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
  },
}));

jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: {
    onFollowDeleted: jest.fn(),
  },
}));

jest.mock('@/lib/performance-monitor', () => ({
  getDbQueryCount: jest.fn(() => 0),
  recordRequest: jest.fn(),
  resetDbQueryCount: jest.fn(),
}));

import { DELETE } from './route';
import { db } from '@/lib/db';

const mockDeletePlayRecord = db.deletePlayRecord as jest.Mock;
const mockDeleteWatchingFollow = db.deleteWatchingFollow as jest.Mock;
const mockGetAllPlayRecords = db.getAllPlayRecords as jest.Mock;
const mockGetAllWatchingFollows = db.getAllWatchingFollows as jest.Mock;

describe('PlayRecord DELETE lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeletePlayRecord.mockResolvedValue(undefined);
    mockDeleteWatchingFollow.mockResolvedValue(undefined);
  });

  it('deletes the matching Follow after deleting one PlayRecord', async () => {
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
  });

  it('clears WatchingFollows when all PlayRecords are cleared', async () => {
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
    expect(mockDeleteWatchingFollow).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video-1',
    );
    expect(mockDeleteWatchingFollow).toHaveBeenCalledWith(
      'alice',
      'source-b',
      'video-2',
    );
  });
});
