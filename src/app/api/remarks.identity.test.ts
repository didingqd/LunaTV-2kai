/** @jest-environment node */

import { NextRequest } from 'next/server';

import { buildContentIdentityKey } from '@/lib/content-identity';
import type { RemarksMap } from '@/lib/video-remarks.server';

let mockUsername = 'alice';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(() => ({ username: mockUsername })),
}));

jest.mock('@/lib/admin-auth', () => ({
  ensureAdmin: jest.fn(async () => undefined),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(async () => ({
    UserConfig: {
      Users: [
        { username: 'alice', banned: false },
        { username: 'bob', banned: false },
      ],
    },
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

import { db } from '@/lib/db';

import { POST as PUSH } from './admin/remarks/push/route';
import { DELETE, GET, POST } from './remarks/route';

const cacheKey = 'user:alice:video_remarks';
const bobCacheKey = 'user:bob:video_remarks';
const record = {
  remark: 'legacy',
  updatedAt: 10,
  origin: 'manual' as const,
};

let storedRemarks: RemarksMap;
let cache: Map<string, RemarksMap>;

function setAliceRemarks(remarks: RemarksMap) {
  storedRemarks = remarks;
  cache.set(cacheKey, storedRemarks);
}

function requestUrl(source: string, id: string, updatedAt?: number): string {
  const params = new URLSearchParams({ source, id });
  if (updatedAt !== undefined) params.set('updatedAt', String(updatedAt));
  return `http://localhost/api/remarks?${params.toString()}`;
}

describe('/api/remarks ContentIdentity compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsername = 'alice';
    storedRemarks = {};
    cache = new Map([[cacheKey, storedRemarks]]);
    (db.getCache as jest.Mock).mockImplementation(
      async (key: string) => cache.get(key) ?? {},
    );
    (db.setCache as jest.Mock).mockImplementation(
      async (key: string, remarks: RemarksMap) => {
        const next = { ...remarks };
        cache.set(key, next);
        if (key === cacheKey) storedRemarks = next;
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
    // 【删除墓碑配套】DELETE 现在留下空备注墓碑而非移除键。
    expect(storedRemarks[canonicalKey]).toMatchObject({ remark: '' });
  });

  it('reads safe legacy data and persists canonical lazy migration', async () => {
    setAliceRemarks({ abc__123: record });
    const canonicalKey = buildContentIdentityKey('abc', '123');

    const response = await GET(new NextRequest(requestUrl('abc', '123')));

    expect(await response.json()).toEqual(record);
    expect(storedRemarks[canonicalKey]).toEqual(record);
    expect(storedRemarks.abc__123).toEqual(record);
    expect(db.setCache).toHaveBeenCalledTimes(1);
  });

  it('prefers canonical data over legacy data', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    setAliceRemarks({
      [canonicalKey]: { ...record, remark: 'canonical' },
      abc__123: record,
    });

    const response = await GET(new NextRequest(requestUrl('abc', '123')));

    expect(await response.json()).toMatchObject({ remark: 'canonical' });
    expect(db.setCache).not.toHaveBeenCalled();
  });

  it('deletes canonical and confirmed legacy data', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    setAliceRemarks({
      [canonicalKey]: record,
      abc__123: record,
    });

    await DELETE(
      new NextRequest(requestUrl('abc', '123', 10), { method: 'DELETE' }),
    );

    // 【删除墓碑配套】canonical 主键留下空备注墓碑，legacy 键被移除。
    expect(storedRemarks[canonicalKey]).toMatchObject({ remark: '' });
    expect(storedRemarks.abc__123).toBeUndefined();
    // 墓碑时间戳必须大于被删记录，否则跨端合并时赢不过旧副本。
    expect(
      (storedRemarks[canonicalKey]?.updatedAt ?? 0) > record.updatedAt,
    ).toBe(true);
  });

  // 【回归·删除被静默跳过 + 墓碑兜底】真实客户端（App 的 _deleteRemoteRecord
  // 与 Web 的 deleteVideoRemark）发 DELETE 时都不携带 updatedAt；记录的
  // updatedAt 由客户端时钟写入、可能超前于服务器时钟。修复后：DELETE 无条件
  // 删除，且墓碑时间戳按 max(服务器时钟, 原记录+1) 兜底，保证即使原记录
  // 时间戳超前，墓碑也能在合并时获胜。
  it('deletes without updatedAt and leaves a tombstone even when the record timestamp is ahead of the server clock', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    const futureRecord = {
      remark: 'future',
      updatedAt: Date.now() + 60_000,
      origin: 'manual' as const,
    };
    setAliceRemarks({ [canonicalKey]: futureRecord });

    const response = await DELETE(
      new NextRequest(requestUrl('abc', '123'), { method: 'DELETE' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(storedRemarks[canonicalKey]).toMatchObject({ remark: '' });
    // 【墓碑重设计】墓碑现在带显式 deletedAt 标记。
    expect(storedRemarks[canonicalKey]?.deletedAt).toBeDefined();
    expect(
      (storedRemarks[canonicalKey]?.updatedAt ?? 0) > futureRecord.updatedAt,
    ).toBe(true);
  });

  // 【墓碑重设计·新增契约】POST 空 remark + manual origin = 删除墓碑通道：
  // 写显式墓碑（deletedAt），时间戳由服务端时钟盖章（max(服务器时钟,
  // 原记录+1)），不采纳客户端传入的 updatedAt。
  it('stamps an explicit tombstone with the server clock on POST with an empty manual remark', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    const futureRecord = {
      remark: 'old',
      updatedAt: Date.now() + 60_000,
      origin: 'manual' as const,
    };
    setAliceRemarks({ [canonicalKey]: futureRecord });

    const response = await POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'abc',
          id: '123',
          remark: '',
          updatedAt: 1,
          origin: 'manual',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      record: { remark: string; updatedAt: number; deletedAt?: number };
    };
    expect(body.success).toBe(true);
    expect(body.record).toMatchObject({ remark: '' });
    expect(body.record.deletedAt).toBeDefined();
    expect(body.record.updatedAt).toBeGreaterThan(futureRecord.updatedAt);
    expect(storedRemarks[canonicalKey]).toEqual(body.record);
  });

  // 【墓碑重设计·新增契约】POST 活记录由服务端时钟盖章：客户端传入的
  // updatedAt 不再作为决胜依据（旧实现存客户端时间戳，跨时钟域比较导致
  // 删除墓碑被超前的旧副本压住）。
  it('stamps live POST writes with the server clock instead of the client timestamp', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    const before = Date.now();

    await POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'abc',
          id: '123',
          remark: 'fresh',
          updatedAt: 9_999_999_999_999,
          origin: 'manual',
        }),
      }),
    );

    const stored = storedRemarks[canonicalKey];
    expect(stored?.remark).toBe('fresh');
    expect(stored?.deletedAt).toBeUndefined();
    expect(stored?.updatedAt).toBeGreaterThanOrEqual(before);
    // 客户端传入的超前时间戳绝不落库。
    expect(stored?.updatedAt).toBeLessThan(9_999_999_999_999);
  });

  // 【墓碑重设计·新增契约】用户在墓碑后重新保存备注 = 显式复活：新活记录
  // 覆盖墓碑并清除 deletedAt。
  it('resurrects a live record over a tombstone via POST', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    setAliceRemarks({
      [canonicalKey]: {
        remark: '',
        updatedAt: 100,
        origin: 'manual',
        deletedAt: 100,
      },
    });

    await POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'abc',
          id: '123',
          remark: 'back again',
          updatedAt: 1,
          origin: 'manual',
        }),
      }),
    );

    expect(storedRemarks[canonicalKey]).toMatchObject({
      remark: 'back again',
    });
    expect(storedRemarks[canonicalKey]?.deletedAt).toBeUndefined();
    expect((storedRemarks[canonicalKey]?.updatedAt ?? 0) > 100).toBe(true);
  });

  // 【墓碑重设计·新增契约】过期墓碑（超过 30 天保留期）在读取视图中不可见：
  // GET 全量不返回已 GC 的墓碑键。
  it('hides expired tombstones from the full GET read view', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    const expired = Date.now() - 31 * 24 * 60 * 60 * 1000;
    setAliceRemarks({
      [canonicalKey]: {
        remark: '',
        updatedAt: expired,
        origin: 'manual',
        deletedAt: expired,
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/remarks'));

    const body = (await response.json()) as Record<string, unknown>;
    expect(body[canonicalKey]).toBeUndefined();
  });

  // 【墓碑重设计·新增契约】写路径顺带物理回收过期墓碑：任意一次 POST 落库
  // 后，过期的墓碑键从存储中消失（updateRemarks 的写回包含剪枝结果）。
  it('physically prunes expired tombstones on the next write', async () => {
    const expiredKey = buildContentIdentityKey('abc', 'gone');
    const liveKey = buildContentIdentityKey('abc', '123');
    const expired = Date.now() - 31 * 24 * 60 * 60 * 1000;
    setAliceRemarks({
      [expiredKey]: {
        remark: '',
        updatedAt: expired,
        origin: 'manual',
        deletedAt: expired,
      },
    });

    await POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'abc',
          id: '123',
          remark: 'keep',
          updatedAt: 1,
          origin: 'manual',
        }),
      }),
    );

    expect(storedRemarks[expiredKey]).toBeUndefined();
    expect(storedRemarks[liveKey]).toMatchObject({ remark: 'keep' });
  });

  // 【墓碑重设计·新增契约】旧隐式墓碑（[0683] 版本后端写的「空 remark +
  // manual origin」）在读取时升格为显式墓碑（deletedAt = updatedAt），
  // 存量数据无需迁移即获得统一判据。时间戳须取近期值：过老的墓碑会被
  // 30 天保留期 GC 剪掉。
  it('upgrades legacy implicit tombstones to explicit deletedAt on read', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    const recent = Date.now() - 1000;
    setAliceRemarks({
      [canonicalKey]: { remark: '', updatedAt: recent, origin: 'manual' },
    });

    const response = await GET(new NextRequest(requestUrl('abc', '123')));

    expect(await response.json()).toMatchObject({
      remark: '',
      deletedAt: recent,
    });
  });

  it('does not migrate or delete ambiguous legacy data', async () => {
    setAliceRemarks({ a____123: record });

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
    setAliceRemarks({ abc__123: record });
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

  it('isolates reads and deletes by authenticated user', async () => {
    await POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'abc',
          id: '123',
          remark: 'alice-only',
          updatedAt: 40,
          origin: 'manual',
        }),
      }),
    );

    mockUsername = 'bob';
    const bobRead = await GET(new NextRequest(requestUrl('abc', '123')));
    expect(await bobRead.json()).toMatchObject({ remark: '' });
    expect(cache.get(bobCacheKey)).toBeUndefined();

    mockUsername = 'alice';
    await DELETE(
      new NextRequest(requestUrl('abc', '123', 40), { method: 'DELETE' }),
    );
    // 【删除墓碑配套】删除后剩一条空备注墓碑而非空 map。
    expect(Object.values(cache.get(cacheKey) ?? {})).toMatchObject([
      { remark: '' },
    ]);
  });

  it('serializes concurrent writes so different remark keys are preserved', async () => {
    const first = POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'abc',
          id: 'video2',
          remark: 'from-device-a',
          updatedAt: 50,
          origin: 'manual',
        }),
      }),
    );
    const second = POST(
      new NextRequest('http://localhost/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'abc',
          id: 'video3',
          remark: 'from-device-b',
          updatedAt: 51,
          origin: 'manual',
        }),
      }),
    );

    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(
      Object.values(storedRemarks)
        .map((item) => item.remark)
        .sort(),
    ).toEqual(['from-device-a', 'from-device-b']);
  });
});
