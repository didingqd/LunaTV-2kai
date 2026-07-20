/** @jest-environment node */

import { NextRequest } from 'next/server';

import { buildContentIdentityKey } from '@/lib/content-identity';
import type { RemarksMap } from '@/lib/video-remarks.server';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(() => ({ username: 'alice' })),
}));

jest.mock('@/lib/admin-auth', () => ({
  ensureAdmin: jest.fn(async () => undefined),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(async () => ({
    UserConfig: { Users: [{ username: 'alice', banned: false }] },
  })),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getCache: jest.fn(),
    setCache: jest.fn(),
  },
}));

jest.mock('@/lib/performance-monitor', () => ({
  getDbQueryCount: jest.fn(() => 0),
  recordRequest: jest.fn(),
  resetDbQueryCount: jest.fn(),
}));

import { DELETE, GET, POST } from './remarks/route';
import { POST as PUSH } from './admin/remarks/push/route';
import { db } from '@/lib/db';

const cacheKey = 'user:alice:video_remarks';
const record = {
  remark: 'legacy',
  updatedAt: 10,
  origin: 'manual' as const,
};

let storedRemarks: RemarksMap;

function requestUrl(source: string, id: string, updatedAt?: number): string {
  const params = new URLSearchParams({ source, id });
  if (updatedAt !== undefined) params.set('updatedAt', String(updatedAt));
  return `http://localhost/api/remarks?${params.toString()}`;
}

describe('/api/remarks ContentIdentity compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storedRemarks = {};
    (db.getCache as jest.Mock).mockImplementation(async () => storedRemarks);
    (db.setCache as jest.Mock).mockImplementation(
      async (key: string, remarks: RemarksMap) => {
        expect(key).toBe(cacheKey);
        storedRemarks = { ...remarks };
      },
    );
  });

  it('creates, reads, updates, and deletes a special-character canonical identity', async () => {
    const source = 'a+b';
    const id = '123+456';
    const canonicalKey = buildContentIdentityKey(source, id);

    const createResponse = await POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          id,
          remark: 'created',
          updatedAt: 20,
          origin: 'manual',
        }),
      }),
    );

    expect(createResponse.status).toBe(200);
    expect(storedRemarks[canonicalKey]?.remark).toBe('created');
    expect(storedRemarks['a+b__123+456']).toBeUndefined();

    const readResponse = await GET(new NextRequest(requestUrl(source, id)));
    expect(await readResponse.json()).toMatchObject({ remark: 'created' });

    await POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          id,
          remark: 'updated',
          updatedAt: 30,
          origin: 'manual',
        }),
      }),
    );
    expect(storedRemarks[canonicalKey]?.remark).toBe('updated');

    await DELETE(
      new NextRequest(requestUrl(source, id, 30), { method: 'DELETE' }),
    );
    expect(storedRemarks[canonicalKey]).toBeUndefined();
  });

  it('reads safe legacy data and persists canonical lazy migration', async () => {
    storedRemarks = { abc__123: record };
    const canonicalKey = buildContentIdentityKey('abc', '123');

    const response = await GET(new NextRequest(requestUrl('abc', '123')));

    expect(await response.json()).toEqual(record);
    expect(storedRemarks[canonicalKey]).toEqual(record);
    expect(storedRemarks.abc__123).toEqual(record);
    expect(db.setCache).toHaveBeenCalledTimes(1);
  });

  it('prefers canonical data over legacy data', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    storedRemarks = {
      [canonicalKey]: { ...record, remark: 'canonical' },
      abc__123: record,
    };

    const response = await GET(new NextRequest(requestUrl('abc', '123')));

    expect(await response.json()).toMatchObject({ remark: 'canonical' });
    expect(db.setCache).not.toHaveBeenCalled();
  });

  it('deletes canonical and confirmed legacy data', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    storedRemarks = {
      [canonicalKey]: record,
      abc__123: record,
    };

    await DELETE(
      new NextRequest(requestUrl('abc', '123', 10), { method: 'DELETE' }),
    );

    expect(storedRemarks[canonicalKey]).toBeUndefined();
    expect(storedRemarks.abc__123).toBeUndefined();
  });

  it('does not migrate or delete ambiguous legacy data', async () => {
    storedRemarks = { a____123: record };

    await GET(new NextRequest(requestUrl('a__', '123')));
    expect(storedRemarks.a____123).toEqual(record);
    expect(db.setCache).not.toHaveBeenCalled();

    await DELETE(
      new NextRequest(requestUrl('a__', '123', 10), { method: 'DELETE' }),
    );
    expect(storedRemarks.a____123).toEqual(record);
  });

  it('keeps Bangumi records on bangumi__id', async () => {
    const canonicalKey = buildContentIdentityKey('bangumi', '123');

    await POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'bangumi',
          id: '123',
          remark: '2026-07-20',
          updatedAt: 20,
          origin: 'bangumi_date',
        }),
      }),
    );

    expect(storedRemarks.bangumi__123?.remark).toBe('2026-07-20');
    expect(storedRemarks[canonicalKey]).toBeUndefined();
  });

  it('uses the adapter when an admin pushes a single legacy remark', async () => {
    storedRemarks = { abc__123: record };
    const canonicalKey = buildContentIdentityKey('abc', '123');

    const response = await PUSH(
      new NextRequest('http://localhost/api/admin/remarks/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'abc', id: '123' }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sourceRecords).toBe(1);
    expect(storedRemarks[canonicalKey]).toEqual(record);
    expect(storedRemarks.abc__123).toEqual(record);
  });
});
