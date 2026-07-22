/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/db', () => ({
  db: {
    getWatchingFollow: jest.fn(),
    getPlayRecord: jest.fn(),
    saveWatchingFollow: jest.fn(),
  },
}));

jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: {
    onFollowCreated: jest.fn(),
    onFollowUpdated: jest.fn(),
    onFollowDeleted: jest.fn(),
  },
}));

jest.mock('./route-utils', () => ({
  requireWatchingFollowUser: jest.fn(async () => ({ username: 'alice' })),
  noStoreJson: (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, init),
}));

import { POST } from './route';
import { db } from '@/lib/db';
import { updateCheckService } from '@/lib/update-check-service';

const mockGetWatchingFollow = db.getWatchingFollow as jest.Mock;
const mockGetPlayRecord = db.getPlayRecord as jest.Mock;
const mockSaveWatchingFollow = db.saveWatchingFollow as jest.Mock;
const mockOnFollowCreated = updateCheckService.onFollowCreated as jest.Mock;

describe('WatchingFollow POST lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetWatchingFollow.mockResolvedValue(null);
  });

  it('rejects creation when the matching PlayRecord is missing', async () => {
    mockGetPlayRecord.mockResolvedValue(null);

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    expect(mockSaveWatchingFollow).not.toHaveBeenCalled();
  });

  it('creates a Follow when the matching PlayRecord exists', async () => {
    mockGetPlayRecord.mockResolvedValue({ index: 1 });

    const response = await POST(createRequest());

    expect(response.status).toBe(201);
    expect(mockSaveWatchingFollow).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video-1',
      expect.objectContaining({
        source: 'source-a',
        id: 'video-1',
        originalEpisodes: 10,
      }),
    );
    expect(mockOnFollowCreated).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'source-a', id: 'video-1' }),
      'alice',
    );
  });

  it('checks for an existing Follow before requiring a PlayRecord', async () => {
    mockGetWatchingFollow.mockResolvedValue({
      source: 'source-a',
      id: 'video-1',
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    expect(mockGetPlayRecord).not.toHaveBeenCalled();
    expect(mockSaveWatchingFollow).not.toHaveBeenCalled();
  });
});

function createRequest() {
  return new NextRequest('http://localhost/api/watching-follows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'source-a',
      id: 'video-1',
      title: 'Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 10,
      enabled: true,
    }),
  });
}
