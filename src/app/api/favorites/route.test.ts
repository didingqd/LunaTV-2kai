/** @jest-environment node */

import { NextRequest } from 'next/server';

import { buildContentIdentityKey } from '@/lib/content-identity';

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
    getFavorite: jest.fn(),
    getAllFavorites: jest.fn(),
    saveFavorite: jest.fn(),
    deleteFavorite: jest.fn(),
  },
}));

jest.mock('@/lib/performance-monitor', () => ({
  getDbQueryCount: jest.fn(() => 0),
  recordRequest: jest.fn(),
  resetDbQueryCount: jest.fn(),
}));

import { DELETE, GET, POST } from './route';
import { db } from '@/lib/db';

const source = 'a+b';
const id = '123+456';
const key = buildContentIdentityKey(source, id);
const favorite = {
  title: 'Demo',
  source_name: 'Source',
  year: '2026',
  cover: '',
  total_episodes: 12,
  save_time: 1,
  search_title: 'Demo',
};

describe('Favorite ContentIdentity API compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.getFavorite as jest.Mock).mockResolvedValue(favorite);
    (db.getAllFavorites as jest.Mock).mockResolvedValue({});
    (db.saveFavorite as jest.Mock).mockResolvedValue(undefined);
    (db.deleteFavorite as jest.Mock).mockResolvedValue(undefined);
  });

  it('creates a Favorite with a canonical key without changing the request shape', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, favorite }),
      }),
    );

    expect(response.status).toBe(200);
    expect(db.saveFavorite).toHaveBeenCalledWith('alice', source, id, favorite);
  });

  it('queries a Favorite with a canonical key', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/favorites?key=${encodeURIComponent(key)}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(db.getFavorite).toHaveBeenCalledWith('alice', source, id);
  });

  it('deletes a Favorite with a canonical key', async () => {
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/favorites?key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      ),
    );

    expect(response.status).toBe(200);
    expect(db.deleteFavorite).toHaveBeenCalledWith('alice', source, id);
  });

  it('continues to accept an unambiguous legacy key', async () => {
    await GET(
      new NextRequest(
        `http://localhost/api/favorites?key=${encodeURIComponent('bangumi+123+456')}`,
      ),
    );

    expect(db.getFavorite).toHaveBeenCalledWith('alice', 'bangumi', '123+456');
  });
});
