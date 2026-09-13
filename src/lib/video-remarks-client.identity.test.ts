import { buildContentIdentityKey } from './content-identity';

let mockPrincipal: string | null = 'alice';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(() =>
    mockPrincipal ? { username: mockPrincipal } : null,
  ),
}));

const storageKey = 'moontv_video_card_remarks';

type ClientModule = typeof import('./video-remarks.client');

function loadClient(): ClientModule {
  return require('./video-remarks.client') as ClientModule;
}

function response(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: jest.fn(async () => data),
  } as unknown as Response;
}

function readStoredEnvelope() {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) throw new Error('Expected Video Remarks storage envelope');
  return JSON.parse(raw) as {
    version: number;
    legacy: Record<string, unknown>;
    principals: Record<
      string,
      { principal: string; data: Record<string, unknown> }
    >;
  };
}

describe('Video Remarks client identity', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    mockPrincipal = 'alice';
    global.fetch = jest.fn(async () => response({ record: null }));
  });

  it.each([
    ['source', '123'],
    ['a+b', '123+456'],
    ['测试源', '第1集'],
    [' a ', ' 123 '],
  ])('writes canonical data for source=%s id=%s', async (source, id) => {
    const client = loadClient();
    const trimmedSource = source.trim();
    const trimmedId = id.trim();
    const canonicalKey = buildContentIdentityKey(trimmedSource, trimmedId);

    await client.saveVideoRemark(source, id, 'remark');

    const envelope = readStoredEnvelope();
    expect(envelope.version).toBe(2);
    expect(envelope.principals.alice.principal).toBe('alice');
    expect(envelope.principals.alice.data[canonicalKey]).toMatchObject({
      remark: 'remark',
      origin: 'manual',
    });
    expect(client.videoRemarkKey(source, id)).toBe(canonicalKey);
    expect(client.getLocalVideoRemark(source, id)).toBe('remark');
  });

  it('reads an unscoped safe legacy map without rewriting it', () => {
    const raw = JSON.stringify({
      abc__123: { remark: 'legacy', updatedAt: 1, origin: 'manual' },
    });
    window.localStorage.setItem(storageKey, raw);

    const client = loadClient();

    expect(client.getLocalVideoRemark('abc', '123')).toBe('legacy');
    expect(window.localStorage.getItem(storageKey)).toBe(raw);
  });

  it('refuses an ambiguous unscoped legacy key', () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        a____123: { remark: 'ambiguous', updatedAt: 1, origin: 'manual' },
      }),
    );

    expect(loadClient().getLocalVideoRemark('a__', '123')).toBe('');
  });

  it('does not upload an unscoped legacy map', async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        abc__123: { remark: 'legacy', updatedAt: 100, origin: 'manual' },
      }),
    );
    global.fetch = jest.fn(async () => response({}));

    await loadClient().syncVideoRemarks();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/remarks', {
      cache: 'no-store',
    });
    expect(readStoredEnvelope().legacy.abc__123).toBeDefined();
  });

  it('does not write or upload when no principal is available', async () => {
    mockPrincipal = null;
    const client = loadClient();

    await client.saveVideoRemark('source', '123', 'remark');
    await client.syncVideoRemarks();

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows unscoped legacy data without syncing when principal is absent', async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        abc__123: { remark: 'legacy', updatedAt: 1, origin: 'manual' },
      }),
    );
    mockPrincipal = null;

    const client = loadClient();
    expect(client.getLocalVideoRemark('abc', '123')).toBe('legacy');
    await client.syncVideoRemarks();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('isolates user A data from user B reads and sync', async () => {
    const client = loadClient();
    await client.saveVideoRemark('source', '123', 'user-a');
    expect(client.getLocalVideoRemark('source', '123')).toBe('user-a');

    mockPrincipal = 'bob';
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValue(response({}));

    expect(client.getLocalVideoRemark('source', '123')).toBe('');
    await client.syncVideoRemarks();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(readStoredEnvelope().principals.alice.data).not.toEqual({});
    expect(readStoredEnvelope().principals.bob.data).toEqual({});

    mockPrincipal = 'alice';
    expect(client.getLocalVideoRemark('source', '123')).toBe('user-a');
  });

  it('prefers canonical server data over a scoped legacy record', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        legacy: {},
        principals: {
          alice: {
            principal: 'alice',
            data: {
              abc__123: {
                remark: 'local legacy',
                updatedAt: 100,
                origin: 'manual',
              },
            },
          },
        },
      }),
    );
    global.fetch = jest.fn(async () =>
      response({
        [canonicalKey]: {
          remark: 'server canonical',
          updatedAt: 2,
          origin: 'manual',
        },
      }),
    );

    const client = loadClient();
    await client.syncVideoRemarks();

    expect(client.getLocalVideoRemark('abc', '123')).toBe('server canonical');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('deletes canonical and safe legacy data but preserves ambiguous data', () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        legacy: {},
        principals: {
          alice: {
            principal: 'alice',
            data: {
              [canonicalKey]: {
                remark: 'canonical',
                updatedAt: 2,
                origin: 'manual',
              },
              abc__123: {
                remark: 'legacy',
                updatedAt: 1,
                origin: 'manual',
              },
              a____123: {
                remark: 'ambiguous',
                updatedAt: 1,
                origin: 'manual',
              },
            },
          },
        },
      }),
    );

    const client = loadClient();
    expect(client.deleteLocalVideoRemark('abc', '123')).toBe(true);
    expect(client.deleteLocalVideoRemark('a__', '123')).toBe(false);

    const data = readStoredEnvelope().principals.alice.data;
    expect(data[canonicalKey]).toBeUndefined();
    expect(data.abc__123).toBeUndefined();
    expect(data.a____123).toBeDefined();
  });

  it('retries an offline Bangumi manual remark with its semantic identity', async () => {
    const client = loadClient();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    await client.saveVideoRemark('bangumi', '123', 'manual');

    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ record: null }));
    await client.syncVideoRemarks();

    expect(
      readStoredEnvelope().principals.alice.data.bangumi__123,
    ).toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/remarks',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"source":"bangumi"'),
      }),
    );
  });

  // 【墓碑重设计·新增·防复活核心契约】远端墓碑无条件获胜：本地旧副本即使
  // 时间戳更大（客户端时钟超前）也不允许反超墓碑重传，「删除了过一会儿
  // 又回来」的主路径被封死。
  it('lets a remote tombstone win over a newer local copy without re-upload', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        legacy: {},
        principals: {
          alice: {
            principal: 'alice',
            data: {
              [canonicalKey]: {
                remark: 'stale local copy',
                updatedAt: Date.now() + 60_000,
                origin: 'manual',
              },
            },
          },
        },
      }),
    );
    global.fetch = jest.fn(async () =>
      response({
        [canonicalKey]: {
          remark: '',
          updatedAt: Date.now(),
          origin: 'manual',
          deletedAt: Date.now(),
        },
      }),
    );

    const client = loadClient();
    await client.syncVideoRemarks();

    expect(client.getLocalVideoRemark('abc', '123')).toBe('');
    // 只有 GET，没有任何 POST（旧副本不重传）。
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const data = readStoredEnvelope().principals.alice.data;
    expect(data[canonicalKey]).toMatchObject({ deletedAt: expect.any(Number) });
  });

  // 【墓碑重设计·新增契约】删除走 POST 空 remark + manual origin 通道，
  // 本地写墓碑并采纳服务端盖章的墓碑记录。
  it('deletes through the POST tombstone channel and adopts the server stamp', async () => {
    const client = loadClient();
    await client.saveVideoRemark('abc', '123', 'to be deleted');
    (global.fetch as jest.Mock).mockClear();
    const serverStamp = Date.now() + 5000;
    (global.fetch as jest.Mock).mockResolvedValue(
      response({
        success: true,
        record: {
          remark: '',
          updatedAt: serverStamp,
          origin: 'manual',
          deletedAt: serverStamp,
        },
      }),
    );

    const deleted = await client.deleteVideoRemark('abc', '123');

    expect(deleted).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/remarks',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"remark":""'),
      }),
    );
    const canonicalKey = buildContentIdentityKey('abc', '123');
    expect(
      readStoredEnvelope().principals.alice.data[canonicalKey],
    ).toMatchObject({
      remark: '',
      deletedAt: serverStamp,
    });
    expect(client.getLocalVideoRemark('abc', '123')).toBe('');
  });

  // 【墓碑重设计·新增契约】离线删除（POST 失败）保留本地墓碑；远端仍有
  // 活记录时，下一次 sync 通过墓碑上传传播删除意图。
  it('replays an offline delete as a tombstone upload while a live record exists remotely', async () => {
    const client = loadClient();
    await client.saveVideoRemark('abc', '123', 'to be deleted');
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        response({
          [buildContentIdentityKey('abc', '123')]: {
            remark: 'to be deleted',
            updatedAt: 100,
            origin: 'manual',
          },
        }),
      )
      .mockResolvedValueOnce(response({ record: null }));

    await client.deleteVideoRemark('abc', '123');
    expect(client.getLocalVideoRemark('abc', '123')).toBe('');

    await client.syncVideoRemarks();

    // GET + 墓碑 POST 重放，删除意图传播到服务端。
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/remarks',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"remark":""'),
      }),
    );
  });

  // 【墓碑重设计·新增契约】本地墓碑 + 远端缺失（记录已被服务端 GC）时不
  // 重放墓碑，避免墓碑每轮 GC 后被重传重生、30 天保留期形同虚设。
  it('does not replay a local tombstone when the remote record is gone', async () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        legacy: {},
        principals: {
          alice: {
            principal: 'alice',
            data: {
              [canonicalKey]: {
                remark: '',
                updatedAt: 10,
                origin: 'manual',
                deletedAt: 10,
              },
            },
          },
        },
      }),
    );
    global.fetch = jest.fn(async () => response({}));

    const client = loadClient();
    await client.syncVideoRemarks();

    // 只有 GET，墓碑不重放。
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(client.getLocalVideoRemark('abc', '123')).toBe('');
  });
});
