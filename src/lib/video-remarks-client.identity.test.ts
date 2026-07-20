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
});
