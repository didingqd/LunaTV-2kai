/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/db', () => ({
  db: {
    advanceWatchingFollowOriginalEpisodes: jest.fn(),
  },
}));

jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: {
    refreshResultAfterBaselineAdvance: jest.fn(),
  },
}));

jest.mock('../../../route-utils', () => ({
  requireWatchingFollowUser: jest.fn(async () => ({ username: 'alice' })),
  noStoreJson: (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, init),
}));

import { db } from '@/lib/db';
import { updateCheckService } from '@/lib/update-check-service';
import { POST } from './route';

const advanceOriginalEpisodes =
  db.advanceWatchingFollowOriginalEpisodes as jest.Mock;
const refreshResultAfterBaselineAdvance =
  updateCheckService.refreshResultAfterBaselineAdvance as jest.Mock;

describe('WatchingFollow originalEpisodes advance route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('advances the baseline through the dedicated monotonic endpoint', async () => {
    advanceOriginalEpisodes.mockResolvedValue({
      found: true,
      changed: true,
      previousEpisodes: 2,
      originalEpisodes: 8,
      follow: follow({ originalEpisodes: 8 }),
    });

    const response = await POST(request(8), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(advanceOriginalEpisodes).toHaveBeenCalledWith(
      'alice',
      'main',
      'demo',
      8,
    );
    expect(refreshResultAfterBaselineAdvance).toHaveBeenCalledWith({
      userId: 'alice',
      source: 'main',
      resourceId: 'demo',
      latestEpisode: 8,
    });
    expect(body).toMatchObject({
      source: 'main',
      id: 'demo',
      originalEpisodes: 8,
      baselineChanged: true,
      previousOriginalEpisodes: 2,
    });
  });

  it('accepts stale confirmations without lowering the stored baseline', async () => {
    advanceOriginalEpisodes.mockResolvedValue({
      found: true,
      changed: false,
      previousEpisodes: 8,
      originalEpisodes: 8,
      follow: follow({ originalEpisodes: 8 }),
    });

    const response = await POST(request(6), context());

    expect(response.status).toBe(200);
    expect(advanceOriginalEpisodes).toHaveBeenCalledWith(
      'alice',
      'main',
      'demo',
      6,
    );
    expect(refreshResultAfterBaselineAdvance).not.toHaveBeenCalled();
  });

  it('returns 404 when the follow does not exist', async () => {
    advanceOriginalEpisodes.mockResolvedValue({
      found: false,
      changed: false,
      previousEpisodes: 0,
      originalEpisodes: 0,
      follow: null,
    });

    const response = await POST(request(8), context());

    expect(response.status).toBe(404);
  });
});

function request(originalEpisodes: number) {
  return new NextRequest(
    'http://localhost/api/watching-follows/main/demo/original-episodes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalEpisodes }),
    },
  );
}

function context() {
  return {
    params: Promise.resolve({ source: 'main', id: 'demo' }),
  };
}

function follow({ originalEpisodes }: { originalEpisodes: number }) {
  return {
    source: 'main',
    id: 'demo',
    title: 'Demo',
    cover: '',
    year: '2026',
    type: 'tv',
    originalEpisodes,
    createdAt: 1000,
    updatedAt: 2000,
    enabled: true,
  };
}
