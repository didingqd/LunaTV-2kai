import { getAuthInfoFromBrowserCookie } from './auth';
import { resolveContentIdentity } from './content-identity';

/**
 * 【自定义标签·新增】视频自定义标签的浏览器端客户端。
 *
 * 本模块是 video-remarks.client.ts 的简化同构版本：localStorage 信封（version 2
 * + 按登录用户 principal 隔离）+ `/api/videotags` 合并同步（GET 全量 → 合并
 * （远端墓碑无条件获胜 + local-wins 上传 + 采纳服务端盖章）→ 逐条 POST）。
 *
 * 相比备注去掉了：origin（标签无 bangumi 自动来源）、legacy/bangumi 键迁移
 * （标签是全新功能，键一律用 canonical 身份键）、admin 推送。内容体是标签
 * 数组而非单个 remark。键与 App 端 ContentIdentity.canonicalKey、后端
 * resolveTagWriteKey 逐字符一致（均为 encodeURIComponent(JSON.stringify([source,id]))）。
 */

export type VideoTagRecord = {
  /** 用户为该内容自定义的标签数组（已 trim/去重/截断）。 */
  tags: string[];
  /** 版本裁决时间戳。 */
  updatedAt: number;
  /** 显式删除墓碑标记：有值即代表该记录已删除，tags 强制为空。 */
  deletedAt?: number;
};

type TagsMap = Record<string, VideoTagRecord>;

type PrincipalTags = {
  principal: string;
  data: TagsMap;
};

type VideoTagsStorageEnvelope = {
  version: 2;
  legacy: TagsMap;
  principals: Record<string, PrincipalTags>;
};

type UploadCandidate = {
  source: string;
  id: string;
  record: VideoTagRecord;
};

const STORAGE_KEY = 'moontv_video_tags';
const STORAGE_VERSION = 2;

/** 单个标签最大长度（超出静默截断），与 App/后端一致。 */
export const MAX_TAG_LENGTH = 20;
/** 每个内容最多标签数（超出静默截断），与 App/后端一致。 */
export const MAX_TAGS_PER_VIDEO = 10;

let cache: VideoTagsStorageEnvelope | null = null;
const syncPromises = new Map<string, Promise<TagsMap>>();
let syncListenersInstalled = false;
let principalWatcherInstalled = false;
let observedPrincipal: string | null = null;
let principalWatcherHandle: number | null = null;
const listeners = new Set<() => void>();

function resolvePrincipal(): string | null {
  const username = getAuthInfoFromBrowserCookie()?.username?.trim();
  return username || null;
}

/** 解析 (source, id) 的 canonical 存储键；非法身份返回空串。 */
export function videoTagKey(source: string, id: string): string {
  const identity = resolveContentIdentity({
    source: source.trim(),
    id: id.trim(),
  });
  return identity ? identity.identityKey : '';
}

function isTombstone(record: VideoTagRecord): boolean {
  return record.deletedAt !== undefined;
}

function coalesceTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 规整标签数组：逐个 trim、丢弃空串、按长度上限截断、去重（保序）、数量上限
 * 截断。与 App VideoTagService.normalizeTags、后端 normalizeTagList 同口径。
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

function normalizeRecord(value: unknown): VideoTagRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const deletedAtRaw = raw.deletedAt;
  const deletedAt =
    typeof deletedAtRaw === 'number' && Number.isFinite(deletedAtRaw)
      ? deletedAtRaw
      : undefined;

  // 显式墓碑：deletedAt 有值 → tags 强制清空，防脏数据借墓碑壳带内容复活。
  if (deletedAt !== undefined) {
    return {
      tags: [],
      updatedAt: coalesceTimestamp(raw.updatedAt, deletedAt),
      deletedAt,
    };
  }

  // 空标签升格为显式墓碑（deletedAt = updatedAt），三端判据统一。
  const tags = normalizeTagList(raw.tags);
  if (tags.length === 0) {
    const stamped = coalesceTimestamp(raw.updatedAt, 0);
    return { tags: [], updatedAt: stamped, deletedAt: stamped };
  }

  return { tags, updatedAt: coalesceTimestamp(raw.updatedAt, 0) };
}

function normalizeMap(value: unknown): TagsMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, record]) => [key, normalizeRecord(record)] as const)
      .filter(
        (entry): entry is readonly [string, VideoTagRecord] => !!entry[1],
      ),
  );
}

function normalizeEnvelope(value: unknown): VideoTagsStorageEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: STORAGE_VERSION, legacy: {}, principals: {} };
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== STORAGE_VERSION) {
    return {
      version: STORAGE_VERSION,
      legacy: normalizeMap(value),
      principals: {},
    };
  }
  const principals: Record<string, PrincipalTags> = {};
  if (
    raw.principals &&
    typeof raw.principals === 'object' &&
    !Array.isArray(raw.principals)
  ) {
    for (const [key, entry] of Object.entries(
      raw.principals as Record<string, unknown>,
    )) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const principal = entry as Record<string, unknown>;
      if (principal.principal !== key) continue;
      principals[key] = { principal: key, data: normalizeMap(principal.data) };
    }
  }
  return {
    version: STORAGE_VERSION,
    legacy: normalizeMap(raw.legacy),
    principals,
  };
}

function readEnvelope(): VideoTagsStorageEnvelope {
  if (typeof window === 'undefined') {
    return { version: STORAGE_VERSION, legacy: {}, principals: {} };
  }
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? normalizeEnvelope(JSON.parse(raw)) : normalizeEnvelope(null);
  } catch {
    cache = normalizeEnvelope(null);
  }
  return cache;
}

function persistEnvelope(next: VideoTagsStorageEnvelope) {
  cache = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

function notifyTagListeners() {
  listeners.forEach((listener) => listener());
}

function watchPrincipalChanges() {
  if (principalWatcherInstalled || typeof window === 'undefined') return;
  principalWatcherInstalled = true;
  observedPrincipal = resolvePrincipal();
  principalWatcherHandle = window.setInterval(() => {
    const nextPrincipal = resolvePrincipal();
    if (nextPrincipal === observedPrincipal) return;
    observedPrincipal = nextPrincipal;
    notifyTagListeners();
    if (nextPrincipal) {
      syncVideoTags().catch(() => {});
    }
  }, 1000);
}

function readPrincipalTags(principal: string): TagsMap {
  return readEnvelope().principals[principal]?.data || {};
}

function writePrincipalTags(principal: string, data: TagsMap) {
  const current = readEnvelope();
  persistEnvelope({
    ...current,
    principals: {
      ...current.principals,
      [principal]: { principal, data },
    },
  });
}

/** 读取某内容的自定义标签（无/墓碑返回空数组）。 */
export function getLocalVideoTags(source: string, id: string): string[] {
  const key = videoTagKey(source, id);
  if (!key) return [];
  const principal = resolvePrincipal();
  if (!principal) return [];
  const record = readPrincipalTags(principal)[key];
  if (!record || isTombstone(record)) return [];
  return record.tags;
}

/** 当前用户全部标签的并集（去重、排序）= 全局共享标签词表。 */
export function getAllLocalTags(): string[] {
  const principal = resolvePrincipal();
  if (!principal) return [];
  const set = new Set<string>();
  for (const record of Object.values(readPrincipalTags(principal))) {
    if (isTombstone(record)) continue;
    for (const tag of record.tags) set.add(tag);
  }
  return Array.from(set).sort();
}

function mergeTags(local: TagsMap, remote: TagsMap) {
  const merged: TagsMap = { ...remote };
  const localWins: UploadCandidate[] = [];
  for (const [key, localRecord] of Object.entries(local)) {
    const remoteRecord = remote[key];
    // 远端墓碑无条件获胜：本地非待上传旧副本不得凭时间戳反超（防复活）。
    if (remoteRecord && isTombstone(remoteRecord)) continue;
    if (!remoteRecord || localRecord.updatedAt > remoteRecord.updatedAt) {
      // 本地墓碑仅在远端仍有活记录时才需上传传播删除；远端缺失（已 GC）不重放。
      if (isTombstone(localRecord) && !remoteRecord) continue;
      merged[key] = localRecord;
      const identity = resolveContentIdentity(key);
      if (identity) {
        localWins.push({
          source: identity.source,
          id: identity.id,
          record: localRecord,
        });
      }
    }
  }
  return { merged, localWins };
}

function installSyncListeners() {
  if (syncListenersInstalled || typeof window === 'undefined') return;
  syncListenersInstalled = true;
  window.addEventListener('focus', () => {
    syncVideoTags().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncVideoTags().catch(() => {});
    }
  });
}

export function subscribeVideoTags(listener: () => void) {
  watchPrincipalChanges();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && principalWatcherHandle) {
      window.clearInterval(principalWatcherHandle);
      principalWatcherHandle = null;
      principalWatcherInstalled = false;
      observedPrincipal = null;
    }
  };
}

async function uploadTagRecord(
  source: string,
  id: string,
  tags: string[],
): Promise<VideoTagRecord | null> {
  const response = await fetch('/api/videotags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, id, tags }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return normalizeRecord(data?.record);
}

export async function syncVideoTags(): Promise<TagsMap> {
  installSyncListeners();
  const principal = resolvePrincipal();
  if (!principal) return readEnvelope().legacy;

  const active = syncPromises.get(principal);
  if (active) return active;

  const promise = (async () => {
    const local = readPrincipalTags(principal);
    const response = await fetch('/api/videotags', { cache: 'no-store' });
    if (!response.ok) throw new Error(`sync tags failed: ${response.status}`);
    if (resolvePrincipal() !== principal) return local;

    const remote = normalizeMap(await response.json());
    const { merged, localWins } = mergeTags(local, remote);
    writePrincipalTags(principal, merged);
    if (resolvePrincipal() !== principal) return merged;

    // 重放 local-wins 上传并采纳服务端盖章（与备注 client 同一收敛策略）。
    const uploads = await Promise.all(
      localWins.map(async ({ source, id, record }) => {
        try {
          const serverRecord = await uploadTagRecord(source, id, record.tags);
          return serverRecord ? { source, id, record, serverRecord } : null;
        } catch {
          return null;
        }
      }),
    );

    if (resolvePrincipal() === principal) {
      let next = readPrincipalTags(principal);
      let changed = false;
      for (const upload of uploads) {
        if (!upload) continue;
        const key = videoTagKey(upload.source, upload.id);
        if (!key) continue;
        const current = next[key];
        // still-sent 守卫：本地仍是本次发送的乐观记录才采纳，防止吞掉窗口内新编辑。
        if (current && current.updatedAt === upload.record.updatedAt) {
          next = { ...next, [key]: upload.serverRecord };
          changed = true;
        }
      }
      if (changed) writePrincipalTags(principal, next);
    }

    return merged;
  })();

  syncPromises.set(principal, promise);
  try {
    return await promise;
  } finally {
    syncPromises.delete(principal);
  }
}

/** 删除某内容的全部标签（写墓碑 + POST 空 tags 传播删除意图）。 */
export async function deleteVideoTags(source: string, id: string) {
  const principal = resolvePrincipal();
  const key = videoTagKey(source, id);
  if (!principal || !key) return;

  const deletedAt = Date.now();
  writePrincipalTags(principal, {
    ...readPrincipalTags(principal),
    [key]: { tags: [], updatedAt: deletedAt, deletedAt },
  });

  try {
    const serverRecord = await uploadTagRecord(source, id, []);
    const current = readPrincipalTags(principal)[key];
    if (
      resolvePrincipal() === principal &&
      serverRecord &&
      isTombstone(serverRecord) &&
      current &&
      current.updatedAt === deletedAt
    ) {
      writePrincipalTags(principal, {
        ...readPrincipalTags(principal),
        [key]: serverRecord,
      });
    }
  } catch {
    // 离线删除：保留本地墓碑，后续 syncVideoTags 合并时按墓碑规则传播。
  }
}

/** 保存某内容的标签（规整；空 → 删除）。写本地 + POST + 采纳服务端盖章。 */
export async function saveVideoTags(
  source: string,
  id: string,
  tags: string[],
) {
  const normalized = normalizeTagList(tags);
  if (normalized.length === 0) {
    await deleteVideoTags(source, id);
    return;
  }

  const principal = resolvePrincipal();
  const key = videoTagKey(source, id);
  if (!principal || !key) return;

  const record: VideoTagRecord = { tags: normalized, updatedAt: Date.now() };
  writePrincipalTags(principal, {
    ...readPrincipalTags(principal),
    [key]: record,
  });

  try {
    const serverRecord = await uploadTagRecord(source, id, normalized);
    const current = readPrincipalTags(principal)[key];
    if (
      resolvePrincipal() === principal &&
      serverRecord &&
      !isTombstone(serverRecord) &&
      current &&
      current.updatedAt === record.updatedAt
    ) {
      writePrincipalTags(principal, {
        ...readPrincipalTags(principal),
        [key]: serverRecord,
      });
    }
  } catch {
    // 离线编辑保留在当前 principal 命名空间，后续 sync 上传。
  }
}
