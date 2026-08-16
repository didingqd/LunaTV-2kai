/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/db', () => ({
  db: {
    updateWatchingFollow: jest.fn(),
    deleteWatchingFollow: jest.fn(),
  },
}));

jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: {
    onFollowUpdated: jest.fn(),
    onFollowDeleted: jest.fn(),
  },
}));

jest.mock('../../route-utils', () => ({
  requireWatchingFollowUser: jest.fn(async () => ({ username: 'alice' })),
  noStoreJson: (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, init),
}));

import { db } from '@/lib/db';
import { updateCheckService } from '@/lib/update-check-service';
import { PUT } from './route';

const updateWatchingFollow = db.updateWatchingFollow as jest.Mock;
const onFollowUpdated = updateCheckService.onFollowUpdated as jest.Mock;

describe('WatchingFollow item route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects originalEpisodes in ordinary metadata PUT', async () => {
    const response = await PUT(
      request({ title: 'Demo', originalEpisodes: 9 }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(updateWatchingFollow).not.toHaveBeenCalled();
  });

  it('updates metadata without opening originalEpisodes writes', async () => {
    const follow = {
      source: 'main',
      id: 'demo',
      title: 'Updated',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 8,
      createdAt: 1000,
      updatedAt: 2000,
      enabled: true,
    };
    updateWatchingFollow.mockResolvedValue(follow);

    const response = await PUT(request({ title: 'Updated' }), context());

    expect(response.status).toBe(200);
    expect(updateWatchingFollow).toHaveBeenCalledWith('alice', 'main', 'demo', {
      title: 'Updated',
    });
    expect(onFollowUpdated).toHaveBeenCalledWith(follow, 'alice');
  });
});

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/watching-follows/main/demo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context() {
  return {
    params: Promise.resolve({ source: 'main', id: 'demo' }),
  };
}
