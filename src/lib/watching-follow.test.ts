import {
  assertWatchingFollowCanBeStored,
  createWatchingFollow,
  migrateStoredWatchingFollow,
  updateWatchingFollow,
  watchingFollowStorageKey,
  watchingFollowCreateSchema,
  watchingFollowUpdateSchema,
} from '@/lib/watching-follow';
import { buildContentIdentityKey } from '@/lib/content-identity';

const createInput = {
  source: 'source-a',
  id: 'video-123',
  title: '测试剧集',
  cover: 'https://example.com/cover.jpg',
  year: '2026',
  type: 'tv',
  originalEpisodes: 12,
  createdAt: 1000,
  updatedAt: 1000,
  enabled: true,
};

describe('WatchingFollow domain', () => {
  it('创建时原样保存客户端提交的 originalEpisodes 快照', () => {
    const parsed = watchingFollowCreateSchema.parse(createInput);
    const follow = createWatchingFollow(parsed, 9999);

    expect(follow.originalEpisodes).toBe(12);
    expect(follow.createdAt).toBe(1000);
    expect(follow.updatedAt).toBe(1000);
  });

  it('更新元数据时保持 originalEpisodes 和 createdAt 不变', () => {
    const existing = createWatchingFollow(
      watchingFollowCreateSchema.parse(createInput),
    );
    const update = watchingFollowUpdateSchema.parse({
      title: '更新后的标题',
      enabled: false,
    });

    const result = updateWatchingFollow(existing, update, 2000);

    expect(result.title).toBe('更新后的标题');
    expect(result.enabled).toBe(false);
    expect(result.originalEpisodes).toBe(12);
    expect(result.createdAt).toBe(1000);
    expect(result.updatedAt).toBe(2000);
  });

  it('拒绝通过更新输入提交 originalEpisodes', () => {
    const result = watchingFollowUpdateSchema.safeParse({
      title: '更新后的标题',
      originalEpisodes: 24,
    });

    expect(result.success).toBe(false);
  });

  it('拒绝通过更新输入提交 null type', () => {
    const result = watchingFollowUpdateSchema.safeParse({
      type: null,
    });

    expect(result.success).toBe(false);
  });

  it('创建输入不接受客户端派生状态', () => {
    const result = watchingFollowCreateSchema.safeParse({
      ...createInput,
      hasUpdate: true,
      latestEpisodes: 24,
      newEpisodes: 12,
    });

    expect(result.success).toBe(false);
  });

  it('存储守卫拒绝覆盖已有 originalEpisodes', () => {
    const existing = createWatchingFollow(
      watchingFollowCreateSchema.parse(createInput),
    );
    const changed = { ...existing, originalEpisodes: 24 };

    expect(() =>
      assertWatchingFollowCanBeStored(
        existing,
        existing.source,
        existing.id,
        changed,
      ),
    ).toThrow('WatchingFollow.originalEpisodes is immutable');
  });

  it('存储守卫拒绝与 source + id 键不一致的对象', () => {
    const follow = createWatchingFollow(
      watchingFollowCreateSchema.parse(createInput),
    );

    expect(() =>
      assertWatchingFollowCanBeStored(null, 'source-b', follow.id, follow),
    ).toThrow('WatchingFollow identity does not match its storage key');
  });

  it('存储守卫接受包含特殊字符的相同 canonical identity', () => {
    const follow = createWatchingFollow(
      watchingFollowCreateSchema.parse({
        ...createInput,
        source: 'source+a / 中文',
        id: 'video+123 / 空 格',
      }),
    );

    expect(() =>
      assertWatchingFollowCanBeStored(null, follow.source, follow.id, follow),
    ).not.toThrow();
  });

  it('迁移旧存储字段到 camelCase，并使用安全存储 key', () => {
    const migrated = migrateStoredWatchingFollow({
      source: 'source+a',
      id: 'video+123',
      title: '测试剧集',
      cover: '',
      year: '2026',
      type: 'tv',
      original_episodes: 12,
      created_at: 1000,
      updated_at: 1000,
      enabled: true,
    });

    expect(migrated).toMatchObject({
      originalEpisodes: 12,
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(watchingFollowStorageKey('source+a', 'video+123')).toBe(
      buildContentIdentityKey('source+a', 'video+123'),
    );
  });
});
