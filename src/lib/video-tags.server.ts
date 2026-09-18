import { normalizeContentIdentity } from '@/lib/content-identity';
import { db } from '@/lib/db';

/**
 * 【自定义标签·新增】视频自定义标签的服务端存储与合并逻辑。
 *
 * 本模块是 video-remarks.server.ts 的简化同构版本：按内容身份键控、KV blob
 * 存储（per-user）、per-user 串行 mutation queue、服务端时钟单调盖章、显式删除
 * 墓碑（30 天保留）。相比备注去掉了 origin（标签无 bangumi 自动来源概念）与
 * admin 推送。内容体是标签数组而非单个 remark。
 *
 * 键格式与 App 端 ContentIdentity.canonicalKey 逐字符一致
 * （encodeURIComponent(JSON.stringify([source, id]))，由 content-identity 提供）。
 */

export type VideoTagRecord = {
  /** 用户为该内容自定义的标签数组（已 trim/去重/截断）。 */
  tags: string[];
  /** 版本裁决时间戳（服务端时钟盖章）。 */
  updatedAt: number;
  /**
   * 显式删除墓碑标记：有值即代表该记录已被删除，tags 强制为空。
   * 同时是墓碑的 GC 依据（见 TOMBSTONE_RETENTION_MS）。
   */
  deletedAt?: number;
};

export type VideoTagsMap = Record<string, VideoTagRecord>;

/** 单个标签最大长度（超出静默截断），与 App VideoTagService.maxTagLength 对齐。 */
export const MAX_TAG_LENGTH = 20;

/** 每个内容最多标签数（超出静默截断），与 App maxTagsPerVideo 对齐。 */
export const MAX_TAGS_PER_VIDEO = 10;

/**
 * 墓碑保留期：超过该时长未发生新写入的墓碑在读写路径上被物理回收
 * （与备注同口径）。
 */
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function tagsCacheKey(username: string) {
  return `user:${username}:video_tags`;
}

/** 记录是否为删除墓碑（deletedAt 有值）。 */
export function isTombstone(record: VideoTagRecord): boolean {
  return record.deletedAt !== undefined;
}

/**
 * 规整标签数组：逐个 trim、丢弃空串、按长度上限截断、去重（保序）、数量上限
 * 截断。与 App 端 VideoTagService.normalizeTags 同口径。超长/超量一律静默截断
 * 而非拒绝，避免 App 的 pending write 把 4xx 当网络失败永久重试（毒消息）。
 */
export function normalizeTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    let tag = item.trim();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) tag = tag.slice(0, MAX_TAG_LENGTH).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= MAX_TAGS_PER_VIDEO) break;
  }
  return result;
}

/**
 * 物理回收过期墓碑（原地修改，返回是否有变更）。在读取视图与写回路径上顺带
 * 执行：前者保证过期墓碑对调用方不可见，后者借写回真正落库清理。
 */
export function pruneExpiredTombstones(
  tags: VideoTagsMap,
  now = Date.now(),
): boolean {
  let changed = false;
  for (const [key, record] of Object.entries(tags)) {
    if (
      record.deletedAt !== undefined &&
      now - record.deletedAt > TOMBSTONE_RETENTION_MS
    ) {
      delete tags[key];
      changed = true;
    }
  }
  return changed;
}

/** 时间戳字段容错解析：非法/缺失时回退 fallback。 */
function coalesceTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 归一化单条记录：显式墓碑（deletedAt 有值）→ tags 强制清空；空标签升格为
 * 显式墓碑（deletedAt = updatedAt）以统一三端判据；非空标签规整后返回活记录。
 */
export function normalizeRecord(value: unknown): VideoTagRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const deletedAtRaw = raw.deletedAt;
  const deletedAt =
    typeof deletedAtRaw === 'number' && Number.isFinite(deletedAtRaw)
      ? deletedAtRaw
      : undefined;

  if (deletedAt !== undefined) {
    return {
      tags: [],
      updatedAt: coalesceTimestamp(raw.updatedAt, deletedAt),
      deletedAt,
    };
  }

  const tags = normalizeTagList(raw.tags);
  if (tags.length === 0) {
    const stamped = coalesceTimestamp(raw.updatedAt, 0);
    return { tags: [], updatedAt: stamped, deletedAt: stamped };
  }

  return { tags, updatedAt: coalesceTimestamp(raw.updatedAt, 0) };
}

export function normalizeTags(value: unknown): VideoTagsMap {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, record]) => [key, normalizeRecord(record)] as const)
    .filter((entry): entry is readonly [string, VideoTagRecord] => !!entry[1]);
  return Object.fromEntries(entries);
}

/** 解析 (source, id) 的存储键（canonical 身份键）；非法身份返回 null。 */
export function resolveTagWriteKey(source: string, id: string): string | null {
  const identity = normalizeContentIdentity(source.trim(), id.trim());
  return identity ? identity.identityKey : null;
}

export type TagIdentityLookup = {
  key: string;
  record: VideoTagRecord | undefined;
};

/** 按 (source, id) 在标签表中查找记录及其存储键。 */
export function resolveTagEntry(
  tags: VideoTagsMap,
  source: string,
  id: string,
): TagIdentityLookup | null {
  const key = resolveTagWriteKey(source, id);
  if (!key) return null;
  return { key, record: tags[key] };
}

export async function readTags(username: string): Promise<VideoTagsMap> {
  const tags = normalizeTags(await db.getCache(tagsCacheKey(username)));
  // 读取视图顺带回收过期墓碑（对调用方不可见）；不回写，物理清理借
  // updateTags 的写回路径完成，避免 GET 引发额外写放大。
  pruneExpiredTombstones(tags);
  return tags;
}

export async function writeTags(username: string, tags: VideoTagsMap) {
  await db.setCache(tagsCacheKey(username), tags);
}

const tagMutationQueues = new Map<string, Promise<void>>();

/**
 * per-user 串行化的读-改-写：与备注 updateRemarks 同构，保证同一用户的并发
 * POST/DELETE 不发生 KV blob 覆盖竞态。读取视图已剪枝过期墓碑，写回顺带把
 * 墓碑 GC 物理落库。
 */
export async function updateTags<T>(
  username: string,
  update: (tags: VideoTagsMap) => T | Promise<T>,
): Promise<T> {
  const previous = tagMutationQueues.get(username) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  tagMutationQueues.set(username, tail);

  await previous.catch(() => undefined);

  try {
    const tags = await readTags(username);
    const result = await update(tags);
    await writeTags(username, tags);
    return result;
  } finally {
    releaseCurrent();
    void tail.finally(() => {
      if (tagMutationQueues.get(username) === tail) {
        tagMutationQueues.delete(username);
      }
    });
  }
}
