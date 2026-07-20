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
    getReminder: jest.fn(),
    getAllReminders: jest.fn(),
    saveReminder: jest.fn(),
    deleteReminder: jest.fn(),
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
const reminder = {
  title: 'Demo',
  source_name: 'Source',
  year: '2026',
  cover: '',
  total_episodes: 1,
  save_time: 1,
  search_title: 'Demo',
  releaseDate: '2026-08-01',
};

describe('Reminder ContentIdentity API compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.getReminder as jest.Mock).mockResolvedValue(reminder);
    (db.getAllReminders as jest.Mock).mockResolvedValue({});
    (db.saveReminder as jest.Mock).mockResolvedValue(undefined);
    (db.deleteReminder as jest.Mock).mockResolvedValue(undefined);
  });

  it('creates a Reminder with a canonical key without changing the request shape', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, reminder }),
      }),
    );

    expect(response.status).toBe(200);
    expect(db.saveReminder).toHaveBeenCalledWith('alice', source, id, reminder);
  });

  it('queries a Reminder with a canonical key', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/reminders?key=${encodeURIComponent(key)}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(db.getReminder).toHaveBeenCalledWith('alice', source, id);
  });

  it('deletes a Reminder with a canonical key', async () => {
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/reminders?key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      ),
    );

    expect(response.status).toBe(200);
    expect(db.deleteReminder).toHaveBeenCalledWith('alice', source, id);
  });

  it('continues to accept an unambiguous legacy key', async () => {
    await GET(
      new NextRequest(
        `http://localhost/api/reminders?key=${encodeURIComponent('bangumi+123+456')}`,
      ),
    );

    expect(db.getReminder).toHaveBeenCalledWith('alice', 'bangumi', '123+456');
  });
});
