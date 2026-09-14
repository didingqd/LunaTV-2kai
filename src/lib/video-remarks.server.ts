import { AdminConfig } from '@/lib/admin.types';
import { db } from '@/lib/db';
import {
  normalizeVideoRemarkIdentity,
  type VideoRemarkIdentity,
} from '@/lib/video-remark-identity';

export type RemarkOrigin = 'manual' | 'bangumi_date';

export type RemarkRecord = {
  remark: string;
  updatedAt: number;
  origin: RemarkOrigin;
  /**
   * 【墓碑重设计·新增】显式删除墓碑标记：有值即代表该记录已被用户删除。
   * 旧实现用「空 remark + manual origin」隐式模拟删除，与异常空数据混淆、
   * 各端判据不一；现在删除是一等公民。deletedAt 同时是墓碑的 GC 依据
   * （见 TOMBSTONE_RETENTION_MS）；updatedAt 仍是版本裁决时间戳
   * （服务端时钟盖章，两者取同值）。
   */
  deletedAt?: number;
};

export type RemarksMap = Record<string, RemarkRecord>;

export const MANUAL_ORIGIN: RemarkOrigin = 'manual';
export const BANGUMI_DATE_ORIGIN: RemarkOrigin = 'bangumi_date';

/**
 * 【复查加固·新增】墓碑保留期：超过该时长未发生新写入的墓碑在读写路径上
 * 被物理回收。30 天足以覆盖所有常活端至少一轮同步；离线超过 30 天的端取回
 * 旧副本属可接受边缘（新客户端的防复活合并规则会丢弃非 pending 旧副本）。
 */
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 【复查加固·新增】单条备注长度上限：POST 入参超长时**静默截断**而非 400
 * 拒绝——拒绝会让 App 的 pending write 把 4xx 当作网络失败永久重试，制造
 * 毒消息死循环；截断无失败路径。App UI 已限 30 字（video_menu_bottom_sheet
 * maxLength），Web 的 window.prompt 无上限，这里防的是直接调 API 写入任意
 * 大文本撑爆整份 KV map 并在全量同步中放大到所有端。截断后经 trim，落库
 * 值必然 ≤ 200 字符。
 */
export const MAX_REMARK_LENGTH = 200;

/** 【墓碑重设计·新增】记录是否为删除墓碑（deletedAt 有值）。 */
export function isTombstone(record: RemarkRecord): boolean {
  return record.deletedAt !== undefined;
}

/**
 * 【墓碑重设计·新增】物理回收过期墓碑（原地修改，返回是否有变更）。
 * 在 readRemarks 的读取视图与 updateRemarks 的写回路径上顺带执行：
 * 前者保证过期墓碑对调用方不可见，后者借写回真正落库清理。
 */
export function pruneExpiredTombstones(
  remarks: RemarksMap,
  now = Date.now(),
): boolean {
  let changed = false;
  for (const [key, record] of Object.entries(remarks)) {
    if (
      record.deletedAt !== undefined &&
      now - record.deletedAt > TOMBSTONE_RETENTION_MS
    ) {
      delete remarks[key];
      changed = true;
    }
  }
  return changed;
}

export function remarksCacheKey(username: string) {
  return `user:${username}:video_remarks`;
}

export type RemarkIdentityLookup = {
  identity: VideoRemarkIdentity;
  key: string;
  record: RemarkRecord | undefined;
  migrated: boolean;
};

function resolveServerRemarkIdentity(
  source: string,
  id: string,
): VideoRemarkIdentity | null {
  return normalizeVideoRemarkIdentity(source.trim(), id.trim());
}

function isBangumiSemanticIdentity(identity: VideoRemarkIdentity): boolean {
  return identity.identity.source === 'bangumi';
}

export function resolveRemarkWriteKey(
  source: string,
  id: string,
): string | null {
  const identity = resolveServerRemarkIdentity(source, id);
  if (!identity) return null;

  return isBangumiSemanticIdentity(identity)
    ? identity.legacyKey
    : identity.canonicalKey;
}

export function resolveRemarkEntry(
  remarks: RemarksMap,
  source: string,
  id: string,
): RemarkIdentityLookup | null {
  const identity = resolveServerRemarkIdentity(source, id);
  if (!identity) return null;

  const key = isBangumiSemanticIdentity(identity)
    ? identity.legacyKey
    : identity.canonicalKey;
  const canonicalRecord = remarks[key];
  if (canonicalRecord) {
    return { identity, key, record: canonicalRecord, migrated: false };
  }

  if (
    !isBangumiSemanticIdentity(identity) &&
    identity.migratable &&
    identity.legacyKey !== key
  ) {
    const legacyRecord = remarks[identity.legacyKey];
    if (legacyRecord) {
      remarks[key] = legacyRecord;
      return { identity, key, record: legacyRecord, migrated: true };
    }
  }

  return { identity, key, record: undefined, migrated: false };
}

export function deleteRemarkEntries(
  remarks: RemarksMap,
  source: string,
  id: string,
): boolean {
  const identity = resolveServerRemarkIdentity(source, id);
  if (!identity) return false;

  const key = isBangumiSemanticIdentity(identity)
    ? identity.legacyKey
    : identity.canonicalKey;
  let deleted = false;

  if (Object.prototype.hasOwnProperty.call(remarks, key)) {
    delete remarks[key];
    deleted = true;
  }

  if (
    !isBangumiSemanticIdentity(identity) &&
    identity.migratable &&
    identity.legacyKey !== key
  ) {
    if (Object.prototype.hasOwnProperty.call(remarks, identity.legacyKey)) {
      delete remarks[identity.legacyKey];
      deleted = true;
    }
  }

  return deleted;
}

export function normalizeOrigin(value: unknown): RemarkOrigin {
  return value === BANGUMI_DATE_ORIGIN ? BANGUMI_DATE_ORIGIN : MANUAL_ORIGIN;
}

export function normalizeRecord(value: unknown): RemarkRecord | null {
  if (typeof value === 'string') {
    const remark = value.trim();
    return remark ? { remark, updatedAt: 0, origin: MANUAL_ORIGIN } : null;
  }

  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const remark = typeof raw.remark === 'string' ? raw.remark.trim() : '';
  const origin = normalizeOrigin(raw.origin);

  // 【墓碑重设计·修改】显式墓碑：deletedAt 有值即墓碑，remark 强制为空
  // （防脏数据借墓碑壳带内容复活），origin 归一到 manual（删除动作的用户
  // 语义）。updatedAt 缺失时以 deletedAt 兜底，保证版本比较始终有值。
  const deletedAtRaw = raw.deletedAt;
  const deletedAt =
    typeof deletedAtRaw === 'number' && Number.isFinite(deletedAtRaw)
      ? deletedAtRaw
      : undefined;

  if (deletedAt !== undefined) {
    return {
      remark: '',
      updatedAt: _coalesceTimestamp(raw.updatedAt, deletedAt),
      origin: MANUAL_ORIGIN,
      deletedAt,
    };
  }

  if (!remark && origin !== MANUAL_ORIGIN) return null;

  // 【墓碑重设计·修改】兼容旧隐式墓碑：[0683] 版本后端写的「空 remark +
  // manual origin」记录升格为显式墓碑（deletedAt = updatedAt），三端判据
  // 统一，无需数据迁移。
  if (!remark) {
    return {
      remark: '',
      updatedAt: _coalesceTimestamp(raw.updatedAt, 0),
      origin: MANUAL_ORIGIN,
      deletedAt: _coalesceTimestamp(raw.updatedAt, 0),
    };
  }

  return {
    remark,
    updatedAt: _coalesceTimestamp(raw.updatedAt, 0),
    origin,
  };
}

/** 【墓碑重设计·新增】时间戳字段容错解析：非法/缺失时回退 fallback。 */
function _coalesceTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeRemarks(value: unknown): RemarksMap {
  if (!value || typeof value !== 'object') return {};

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, record]) => [key, normalizeRecord(record)] as const)
    .filter((entry): entry is readonly [string, RemarkRecord] => !!entry[1]);

  return Object.fromEntries(entries);
}

export function manualRemarksOnly(remarks: RemarksMap): RemarksMap {
  // 【墓碑重设计·修改】显式排除墓碑：admin 推送与数据迁移导出只携带活的
  // 手动备注，绝不能把删除墓碑推给其他用户（否则等于替他们"复活"出一条
  // 空备注记录）。旧实现靠 remark.trim() 间接排除，现在墓碑有显式判据。
  return Object.fromEntries(
    Object.entries(remarks).filter(
      ([, record]) =>
        record.origin === MANUAL_ORIGIN &&
        record.remark.trim() &&
        !isTombstone(record),
    ),
  );
}

export async function readRemarks(username: string): Promise<RemarksMap> {
  const remarks = normalizeRemarks(
    await db.getCache(remarksCacheKey(username)),
  );
  // 【墓碑重设计·新增】读取视图顺带回收过期墓碑：过期墓碑对调用方不可见
  // （等同该记录从未存在）。此处不回写存储——物理清理借 updateRemarks 的
  // 写回路径完成，避免 GET 引发额外写放大。
  pruneExpiredTombstones(remarks);
  return remarks;
}

export async function writeRemarks(username: string, remarks: RemarksMap) {
  await db.setCache(remarksCacheKey(username), remarks);
}

const remarkMutationQueues = new Map<string, Promise<void>>();

export async function updateRemarks<T>(
  username: string,
  update: (remarks: RemarksMap) => T | Promise<T>,
): Promise<T> {
  const previous = remarkMutationQueues.get(username) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  remarkMutationQueues.set(username, tail);

  await previous.catch(() => undefined);

  try {
    // 【墓碑重设计·新增】readRemarks 的读取视图已剪枝过期墓碑，这里的写回
    // 使每次变更（含 GET 单条的懒迁移路径）顺带把墓碑 GC 物理落库。
    const remarks = await readRemarks(username);
    const result = await update(remarks);
    await writeRemarks(username, remarks);
    return result;
  } finally {
    releaseCurrent();
    void tail.finally(() => {
      if (remarkMutationQueues.get(username) === tail) {
        remarkMutationQueues.delete(username);
      }
    });
  }
}

export function getConfigUsernames(config: AdminConfig): string[] {
  return Array.from(
    new Set(
      [
        process.env.USERNAME,
        ...config.UserConfig.Users.filter((user) => !user.banned).map(
          (user) => user.username,
        ),
      ].filter((username): username is string => !!username),
    ),
  );
}

export async function pushManualRemarksToUsers(
  fromUsername: string,
  targetUsernames: string[],
  sourceRemarks?: RemarksMap,
) {
  const source = manualRemarksOnly(
    sourceRemarks ?? (await readRemarks(fromUsername)),
  );
  const sourceEntries = Object.entries(source);
  let updatedUsers = 0;
  let insertedRecords = 0;

  for (const username of targetUsernames) {
    if (username === fromUsername) continue;

    const insertedForUser = await updateRemarks(username, (target) => {
      let insertedForTarget = 0;

      for (const [key, record] of sourceEntries) {
        const existing = target[key];
        if (
          existing &&
          existing.origin === MANUAL_ORIGIN &&
          existing.remark.trim()
        ) {
          continue;
        }

        // 【墓碑重设计·注释 + 复查加固·修改】目标用户的墓碑（空 remark）不
        // 拦截推送：admin push 是管理员显式的分发动作，语义即"覆盖分发"，
        // 墓碑视为无内容记录可被覆盖；接收方看到的是管理员重新分发的备注，
        // 非旧副本复活。写入时间戳改为**单调盖章** max(服务器时钟, 目标现有
        // 记录+1)——与 POST/DELETE 同一防回拨范式：目标用户可能残留带超前
        // 客户端时间戳的存量墓碑/记录，直接写 Date.now() 会让推送记录在
        // 目标端 sync 的时间戳比较中输给旧墓碑，推送静默失效。
        const stamped = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
        target[key] = {
          ...record,
          updatedAt: stamped,
          origin: MANUAL_ORIGIN,
        };
        insertedForTarget++;
      }

      return insertedForTarget;
    });

    if (insertedForUser > 0) {
      updatedUsers++;
      insertedRecords += insertedForUser;
    }
  }

  return {
    sourceRecords: sourceEntries.length,
    updatedUsers,
    insertedRecords,
  };
}
