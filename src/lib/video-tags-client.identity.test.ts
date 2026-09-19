import { buildContentIdentityKey } from './content-identity';

let mockPrincipal: string | null = 'alice';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(() =>
    mockPrincipal ? { username: mockPrincipal } : null,
  ),
}));

const storageKey = 'moontv_video_tags';

type ClientModule = typeof import('./video-tags.client');

function loadClient(): ClientModule {
  return require('./video-tags.client') as ClientModule;
}

function response(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: jest.fn(async () => data),
  } as unknown as Response;
}

function readPrincipalData(principal: string): Record<string, unknown> {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return {};
  const envelope = JSON.parse(raw) as {
    principals: Record<string, { data: Record<string, unknown> }>;
  };
  return envelope.principals[principal]?.data || {};
}

describe('Video Tags client', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    mockPrincipal = 'alice';
    // 默认 fetch：GET 返回空 map、POST 返回 null record（各用例按需覆盖）。
    global.fetch = jest.fn(async () => response({}));
  });

  it('normalizeTagList trims, dedupes, caps length and count', () => {
    const client = loadClient();
    const long = 'x'.repeat(client.MAX_TAG_LENGTH + 5);
    const many = Array.from(
      { length: client.MAX_TAGS_PER_VIDEO + 3 },
      (_, i) => `t${i}`,
    );
    expect(client.normalizeTagList([' 动漫 ', '动漫', '', '国产剧'])).toEqual([
      '动漫',
      '国产剧',
    ]);
    expect(client.normalizeTagList([long])[0]).toHaveLength(
      client.MAX_TAG_LENGTH,
    );
    expect(client.normalizeTagList(many)).toHaveLength(
      client.MAX_TAGS_PER_VIDEO,
    );
    expect(client.normalizeTagList('nope' as unknown)).toEqual([]);
  });

  it('saveVideoTags writes canonical key and reads back', async () => {
    const client = loadClient();
    const key = buildContentIdentityKey('provider', 'v1');

    await client.saveVideoTags('provider', 'v1', [' 动漫 ', '动漫', '国产剧']);

    const data = readPrincipalData('alice');
    expect(data[key]).toMatchObject({ tags: ['动漫', '国产剧'] });
    expect(client.videoTagKey('provider', 'v1')).toBe(key);
    expect(client.getLocalVideoTags('provider', 'v1')).toEqual([
      '动漫',
      '国产剧',
    ]);
  });

  it('getAllLocalTags returns the deduped union (global vocabulary)', async () => {
    const client = loadClient();
    await client.saveVideoTags('provider', 'a', ['动漫', '神作']);
    await client.saveVideoTags('provider', 'b', ['国产剧', '动漫']);
    expect(client.getAllLocalTags()).toEqual(['动漫', '国产剧', '神作']);
  });

  it('empty tags delete physically-propagating tombstone; not shown', async () => {
    const client = loadClient();
    await client.saveVideoTags('provider', 'c', ['动漫']);
    await client.saveVideoTags('provider', 'c', []);
    expect(client.getLocalVideoTags('provider', 'c')).toEqual([]);
    // 墓碑记录仍在存储里（deletedAt 有值），但对读取不可见。
    const data = readPrincipalData('alice');
    const key = buildContentIdentityKey('provider', 'c');
    expect((data[key] as { deletedAt?: number }).deletedAt).toBeDefined();
  });

  it('sync: remote tombstone suppresses local resurrection', async () => {
    const client = loadClient();
    // 本地先有活标签。
    await client.saveVideoTags('provider', 'd', ['国产剧']);
    const key = buildContentIdentityKey('provider', 'd');

    // 远端 GET 返回该键的墓碑（更晚的时间戳）。
    global.fetch = jest.fn(async () =>
      response({
        [key]: {
          tags: [],
          updatedAt: Date.now() + 10000,
          deletedAt: Date.now() + 10000,
        },
      }),
    );

    await client.syncVideoTags();
    // 墓碑无条件获胜：本地清空。
    expect(client.getLocalVideoTags('provider', 'd')).toEqual([]);
  });

  it('sync: local-wins uploads and adopts server stamp', async () => {
    const client = loadClient();
    await client.saveVideoTags('provider', 'e', ['悬疑']);
    const key = buildContentIdentityKey('provider', 'e');
    const serverStamp = Date.now() + 5000;

    // GET 返回空（远端无此键）→ local-wins；POST 返回服务端盖章记录。
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return response({
          success: true,
          record: { tags: ['悬疑'], updatedAt: serverStamp },
        });
      }
      return response({});
    }) as unknown as typeof fetch;

    await client.syncVideoTags();

    const data = readPrincipalData('alice');
    // 采纳服务端盖章时间戳。
    expect((data[key] as { updatedAt: number }).updatedAt).toBe(serverStamp);
    expect(client.getLocalVideoTags('provider', 'e')).toEqual(['悬疑']);
  });

  it('guest (no principal) reads empty and does not throw', async () => {
    mockPrincipal = null;
    const client = loadClient();
    expect(client.getLocalVideoTags('provider', 'x')).toEqual([]);
    expect(client.getAllLocalTags()).toEqual([]);
    await client.saveVideoTags('provider', 'x', ['动漫']); // no-op, no throw
    expect(client.getLocalVideoTags('provider', 'x')).toEqual([]);
  });
});
