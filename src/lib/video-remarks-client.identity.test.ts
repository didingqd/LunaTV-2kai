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

  // 【复查加固·新增契约】sync 重放上传采纳服务端盖章：本地时间戳（客户端
  // 时钟，可能超前）被服务端时钟替换后，下一轮 sync 不再重复上传同一条
  // 记录。旧实现不读重放响应，时钟超前的端每轮 sync 都重传，且期间本端
  // 旧内容会压掉其他设备的新编辑。
  it('adopts server stamps for replayed uploads and stops re-uploading', async () => {
    const client = loadClient();
    const canonicalKey = buildContentIdentityKey('abc', '123');
    // 本地记录时间戳超前 60s（客户端时钟快），远端是旧活记录 → 触发重放。
    const ahead = Date.now() + 60_000;
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
                remark: 'local edit',
                updatedAt: ahead,
                origin: 'manual',
              },
            },
          },
        },
      }),
    );
    const serverStamp = Date.now() + 1000;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          [canonicalKey]: {
            remark: 'remote old',
            updatedAt: 100,
            origin: 'manual',
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          record: {
            remark: 'local edit',
            updatedAt: serverStamp,
            origin: 'manual',
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          [canonicalKey]: {
            remark: 'local edit',
            updatedAt: serverStamp,
            origin: 'manual',
          },
        }),
      );

    await client.syncVideoRemarks();

    // 第一轮：GET + 重放 POST，且本地已采纳服务端盖章（时间域对齐）。
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(
      readStoredEnvelope().principals.alice.data[canonicalKey],
    ).toMatchObject({ remark: 'local edit', updatedAt: serverStamp });

    await client.syncVideoRemarks();

    // 第二轮：只有 GET。本地时间戳已等于服务端盖章值，不再触发重传。
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenLastCalledWith('/api/remarks', {
      cache: 'no-store',
    });
  });

  // 【复查加固·新增契约】空备注保存 = 删除意图：转发到删除通道（本地墓碑
  // + POST 空 remark），且 bangumi 自动日期备注不被空保存覆盖（守卫与
  // App 端 saveRemark → deleteRemark 对齐；UI 此前已自行路由，无行为变化）。
  it('routes an empty save through the delete channel without touching bangumi auto remarks', async () => {
    const client = loadClient();
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        legacy: {},
        principals: {
          alice: {
            principal: 'alice',
            data: {
              bangumi__123: {
                remark: '2026-07-20',
                updatedAt: 10,
                origin: 'bangumi_date',
              },
            },
          },
        },
      }),
    );
    global.fetch = jest.fn(async () => response({ record: null }));

    // bangumi 自动备注守卫：删除通道拒绝删除自动备注，本地不动、无上传。
    await client.saveVideoRemark('bangumi', '123', '   ');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(
      readStoredEnvelope().principals.alice.data.bangumi__123,
    ).toMatchObject({ remark: '2026-07-20', origin: 'bangumi_date' });

    // 非 bangumi 场景：走本地墓碑 + POST 空 remark 墓碑通道。
    const manualKey = buildContentIdentityKey('abc', '1');
    (global.fetch as jest.Mock).mockClear();
    await client.saveVideoRemark('abc', '1', '');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/remarks',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"remark":""'),
      }),
    );
    expect(readStoredEnvelope().principals.alice.data[manualKey]).toMatchObject(
      {
        deletedAt: expect.any(Number),
      },
    );
  });
});
