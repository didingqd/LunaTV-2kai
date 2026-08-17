/** @jest-environment node */

import { NextRequest } from 'next/server';

import { buildSkipConfigKey } from '@/lib/skip-config-identity';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(() => ({ username: 'alice' })),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getAllSkipConfigs: jest.fn(async () => ({})),
    getSkipConfigsMeta: jest.fn(async () => ({ revision: 1, updatedAt: 1 })),
    getSkipConfig: jest.fn(),
    setSkipConfig: jest.fn(),
    deleteSkipConfig: jest.fn(),
  },
}));

jest.mock('@/lib/performance-monitor', () => ({
  getDbQueryCount: jest.fn(() => 0),
  recordRequest: jest.fn(),
  resetDbQueryCount: jest.fn(),
}));

import { POST } from './route';
import { db } from '@/lib/db';

const config = { enable: true, intro_time: 90, outro_time: 60 };

describe('SkipConfig ContentIdentity API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['get', 'set', 'delete'] as const)(
    '%s preserves special-character source/id from a canonical key',
    async (action) => {
      const source = 'a+b';
      const id = '123+456';
      const response = await request(action, buildSkipConfigKey(source, id));

      expect(response.status).toBe(200);
      if (action === 'get') {
        expect(db.getSkipConfig).toHaveBeenCalledWith('alice', source, id);
      } else if (action === 'set') {
        expect(db.setSkipConfig).toHaveBeenCalledWith(
          'alice',
          source,
          id,
          config,
        );
      } else {
        expect(db.deleteSkipConfig).toHaveBeenCalledWith('alice', source, id);
      }
    },
  );

  it('accepts an unambiguous legacy key', async () => {
    const response = await request('get', 'bangumi+123');

    expect(response.status).toBe(200);
    expect(db.getSkipConfig).toHaveBeenCalledWith('alice', 'bangumi', '123');
  });

  it('rejects an ambiguous legacy key instead of guessing', async () => {
    const response = await request('get', 'a+b+123');

    expect(response.status).toBe(400);
    expect(db.getSkipConfig).not.toHaveBeenCalled();
  });

  it('preserves douban/title semantic identity behavior', async () => {
    const response = await request(
      'set',
      buildSkipConfigKey('source', '123'),
      'title:C++ Primer:2026',
    );

    expect(response.status).toBe(200);
    expect(db.setSkipConfig).toHaveBeenCalledWith(
      'alice',
      'title:C++ Primer:2026',
      '__identity__',
      config,
    );
  });

  it('normalizes legacy negative outro_time before saving', async () => {
    const response = await request(
      'set',
      buildSkipConfigKey('bangumi', '123'),
      undefined,
      { enable: true, intro_time: 90, outro_time: -60 },
    );

    expect(response.status).toBe(200);
    expect(db.setSkipConfig).toHaveBeenCalledWith(
      'alice',
      'bangumi',
      '123',
      config,
    );
  });

  it('returns skip config meta for getMeta requests', async () => {
    const response = await request('getMeta', 'bangumi+123');

    expect(response.status).toBe(200);
    expect(db.getSkipConfigsMeta).toHaveBeenCalledWith('alice');
    await expect(response.json()).resolves.toEqual({
      meta: { revision: 1, updatedAt: 1 },
    });
  });
});

async function request(
  action: 'get' | 'set' | 'delete' | 'getMeta',
  key: string,
  identityKey?: string,
  overrideConfig = config,
) {
  return POST(
    new NextRequest('http://localhost/api/skipconfigs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        key,
        config: action === 'set' ? overrideConfig : undefined,
        identityKey,
      }),
    }),
  );
}
