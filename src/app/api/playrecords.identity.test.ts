/** @jest-environment node */

import { NextRequest } from 'next/server';

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
    getPlayRecord: jest.fn(),
    savePlayRecord: jest.fn(),
    isStatsSupported: jest.fn(() => false),
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

import { DELETE, POST } from './playrecords/route';
import { db } from '@/lib/db';

const validRecord = {
  title: 'Demo',
  source_name: 'Source',
  index: 1,
  total_episodes: 12,
  play_time: 0,
  total_time: 100,
  save_time: 1,
};

describe('PlayRecord API identity boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an ambiguous legacy key on POST', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/playrecords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'a+b+123', record: validRecord }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'ambiguous legacy identity',
    });
    expect(db.savePlayRecord).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous legacy key on DELETE without cascading Follow', async () => {
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/playrecords?key=${encodeURIComponent('a+b+123')}`,
        { method: 'DELETE' },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'ambiguous legacy identity',
    });
    expect(db.deletePlayRecord).not.toHaveBeenCalled();
    expect(db.deleteWatchingFollow).not.toHaveBeenCalled();
  });

  it('continues to accept an unambiguous legacy key', async () => {
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/playrecords?key=${encodeURIComponent('abc+123')}`,
        { method: 'DELETE' },
      ),
    );

    expect(response.status).toBe(200);
    expect(db.deletePlayRecord).toHaveBeenCalledWith('alice', 'abc', '123');
    expect(db.deleteWatchingFollow).toHaveBeenCalledWith('alice', 'abc', '123');
  });
});
