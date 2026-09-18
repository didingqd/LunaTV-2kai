import { buildContentIdentityKey } from './content-identity';

// 【自定义标签·新增】与 video-remarks-server 测试同款：mock KV 缓存层，只验证
// 纯函数（规整/墓碑/键解析）与 read/update 的合并盖章语义。
jest.mock('@/lib/db', () => ({
  db: {
    getCache: jest.fn(),
    setCache: jest.fn(),
  },
}));

import { db } from '@/lib/db';

import {
  isTombstone,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_VIDEO,
  normalizeRecord,
  normalizeTagList,
  pruneExpiredTombstones,
  readTags,
  resolveTagWriteKey,
  updateTags,
  type VideoTagRecord,
  type VideoTagsMap,
} from './video-tags.server';

const mockedDb = db as unknown as {
  getCache: jest.Mock;
  setCache: jest.Mock;
};

describe('video-tags.server 纯函数', () => {
  it('规整标签：trim/去重/长度上限/数量上限', () => {
    const long = 'x'.repeat(MAX_TAG_LENGTH + 5);
    const many = Array.from(
      { length: MAX_TAGS_PER_VIDEO + 3 },
      (_, i) => `t${i}`,
    );
    expect(normalizeTagList(['  动漫 ', '动漫', '', '国产剧'])).toEqual([
      '动漫',
      '国产剧',
    ]);
    expect(normalizeTagList([long])[0]).toHaveLength(MAX_TAG_LENGTH);
    expect(normalizeTagList(many)).toHaveLength(MAX_TAGS_PER_VIDEO);
    expect(normalizeTagList('not-an-array' as unknown)).toEqual([]);
  });

  it('resolveTagWriteKey 用 canonical 身份键（与 App 逐字符一致）', () => {
    expect(resolveTagWriteKey('provider', 'v1')).toBe(
      buildContentIdentityKey('provider', 'v1'),
    );
    expect(resolveTagWriteKey('', 'v1')).toBeNull();
  });

  it('normalizeRecord：显式墓碑清空 tags；空 tags 升格为墓碑；活记录规整', () => {
    const tomb = normalizeRecord({ tags: ['a'], updatedAt: 5, deletedAt: 5 });
    expect(tomb).toEqual({ tags: [], updatedAt: 5, deletedAt: 5 });
    expect(isTombstone(tomb as VideoTagRecord)).toBe(true);

    const empty = normalizeRecord({ tags: [], updatedAt: 7 });
    expect(empty).toEqual({ tags: [], updatedAt: 7, deletedAt: 7 });

    const active = normalizeRecord({ tags: [' 动漫 ', '动漫'], updatedAt: 3 });
    expect(active).toEqual({ tags: ['动漫'], updatedAt: 3 });
  });

  it('pruneExpiredTombstones 回收过期墓碑', () => {
    const now = Date.now();
    const map: VideoTagsMap = {
      fresh: { tags: [], updatedAt: now, deletedAt: now },
      stale: {
        tags: [],
        updatedAt: now - 40 * 24 * 60 * 60 * 1000,
        deletedAt: now - 40 * 24 * 60 * 60 * 1000,
      },
      active: { tags: ['x'], updatedAt: now },
    };
    const changed = pruneExpiredTombstones(map, now);
    expect(changed).toBe(true);
    expect(map.stale).toBeUndefined();
    expect(map.fresh).toBeDefined();
    expect(map.active).toBeDefined();
  });
});

describe('video-tags.server read/update', () => {
  beforeEach(() => {
    mockedDb.getCache.mockReset();
    mockedDb.setCache.mockReset();
  });

  it('readTags 归一化并剪枝过期墓碑', async () => {
    const stale = Date.now() - 40 * 24 * 60 * 60 * 1000;
    mockedDb.getCache.mockResolvedValue({
      [buildContentIdentityKey('p', 'a')]: { tags: ['动漫'], updatedAt: 1 },
      [buildContentIdentityKey('p', 'b')]: {
        tags: [],
        updatedAt: stale,
        deletedAt: stale,
      },
    });
    const tags = await readTags('alice');
    expect(tags[buildContentIdentityKey('p', 'a')].tags).toEqual(['动漫']);
    expect(tags[buildContentIdentityKey('p', 'b')]).toBeUndefined();
  });

  it('updateTags 串行读改写并落库', async () => {
    const store: Record<string, VideoTagsMap> = {};
    mockedDb.getCache.mockImplementation(async () => store['alice'] ?? {});
    mockedDb.setCache.mockImplementation(
      async (_key: string, data: VideoTagsMap) => {
        store['alice'] = data;
      },
    );

    const key = buildContentIdentityKey('p', 'a');
    await updateTags('alice', (map) => {
      map[key] = { tags: ['动漫'], updatedAt: 100 };
    });
    // 并发两次自增写：串行化后互不覆盖。
    await Promise.all([
      updateTags('alice', (map) => {
        map[buildContentIdentityKey('p', 'b')] = {
          tags: ['国产剧'],
          updatedAt: 101,
        };
      }),
      updateTags('alice', (map) => {
        map[buildContentIdentityKey('p', 'c')] = {
          tags: ['电影'],
          updatedAt: 102,
        };
      }),
    ]);

    const finalMap = store['alice'];
    expect(finalMap[key].tags).toEqual(['动漫']);
    expect(finalMap[buildContentIdentityKey('p', 'b')].tags).toEqual([
      '国产剧',
    ]);
    expect(finalMap[buildContentIdentityKey('p', 'c')].tags).toEqual(['电影']);
  });
});
