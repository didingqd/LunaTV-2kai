import { getAuthInfoFromBrowserCookie } from './auth';
import {
  normalizeVideoRemarkIdentity,
  resolveVideoRemarkIdentity,
  type VideoRemarkIdentity,
} from './video-remark-identity';

export type VideoRemarkRecord = {
  remark: string;
  updatedAt: number;
  origin: VideoRemarkOrigin;
  /**
   * 【墓碑重设计·新增】显式删除墓碑标记：有值即代表该记录已被用户删除。
   * 与服务端 RemarkRecord.deletedAt 语义一致，详见
   * Selene 仓库 docs/video-remark-sync-contract.md 的三端合并契约。
   */
  deletedAt?: number;
};

type RemarksMap = Record<string, VideoRemarkRecord>;
type VideoRemarkOrigin = 'manual' | 'bangumi_date';

type PrincipalRemarks = {
  principal: string;
  data: RemarksMap;
};

type VideoRemarksStorageEnvelope = {
  version: 2;
  legacy: RemarksMap;
  principals: Record<string, PrincipalRemarks>;
};

type ClientRemarkIdentity = {
  resolved: VideoRemarkIdentity;
  primaryKey: string;
  isBangumiSemantic: boolean;
};

type UploadCandidate = {
  source: string;
  id: string;
  record: VideoRemarkRecord;
};

type TrustedRemarksMap = {
  data: RemarksMap;
  promotedCanonicalKeys: Set<string>;
};

const STORAGE_KEY = 'moontv_video_card_remarks';
const MANUAL_ORIGIN: VideoRemarkOrigin = 'manual';
const BANGUMI_DATE_ORIGIN: VideoRemarkOrigin = 'bangumi_date';
const STORAGE_VERSION = 2;
const BANGUMI_PREFIX = 'bangumi__';

let cache: VideoRemarksStorageEnvelope | null = null;
const syncPromises = new Map<string, Promise<RemarksMap>>();
let syncListenersInstalled = false;
let principalWatcherInstalled = false;
let observedPrincipal: string | null = null;
let principalWatcherHandle: number | null = null;
const listeners = new Set<() => void>();

function resolvePrincipal(): string | null {
  const username = getAuthInfoFromBrowserCookie()?.username?.trim();
  return username || null;
}

function resolveClientRemarkIdentity(
  source: string,
  id: string,
): ClientRemarkIdentity | null {
  const resolved = normalizeVideoRemarkIdentity(source.trim(), id.trim());
  if (!resolved) return null;

  const isBangumiSemantic = resolved.identity.source === 'bangumi';
  return {
    resolved,
    primaryKey: isBangumiSemantic ? resolved.legacyKey : resolved.canonicalKey,
    isBangumiSemantic,
  };
}

export function videoRemarkKey(source: string, id: string) {
  return resolveClientRemarkIdentity(source, id)?.primaryKey || '';
}

function normalizeOrigin(value: unknown): VideoRemarkOrigin {
  return value === BANGUMI_DATE_ORIGIN ? BANGUMI_DATE_ORIGIN : MANUAL_ORIGIN;
}

/** 【墓碑重设计·新增】记录是否为删除墓碑（deletedAt 有值）。 */
function isTombstone(record: VideoRemarkRecord): boolean {
  return record.deletedAt !== undefined;
}

/** 【墓碑重设计·新增】时间戳字段容错解析：非法/缺失时回退 fallback。 */
function coalesceTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRecord(value: unknown): VideoRemarkRecord | null {
  if (typeof value === 'string') {
    // 【墓碑重设计·修改】空字符串不再产生 updatedAt:0 的空 manual 记录
    //（与服务端 normalizeRecord 对齐，空串视为无记录）。
    const remark = value.trim();
    return remark ? { remark, updatedAt: 0, origin: MANUAL_ORIGIN } : null;
  }

  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const remark = typeof raw.remark === 'string' ? raw.remark.trim() : '';
  const origin = normalizeOrigin(raw.origin);
  const deletedAtRaw = raw.deletedAt;
  const deletedAt =
    typeof deletedAtRaw === 'number' && Number.isFinite(deletedAtRaw)
      ? deletedAtRaw
      : undefined;

  // 【墓碑重设计·新增】显式墓碑：deletedAt 有值即墓碑，remark 强制为空、
  // origin 归一 manual（与服务端 normalizeRecord 同一判据）。
  if (deletedAt !== undefined) {
    return {
      remark: '',
      updatedAt: coalesceTimestamp(raw.updatedAt, deletedAt),
      origin: MANUAL_ORIGIN,
      deletedAt,
    };
  }

  // 【墓碑重设计·新增】兼容旧隐式墓碑（服务端 [0683] 版本写入的
  // 「空 remark + manual origin」）升格为显式墓碑，三端判据统一。
  if (!remark && origin === MANUAL_ORIGIN) {
    const updatedAt = coalesceTimestamp(raw.updatedAt, 0);
    return {
      remark: '',
      updatedAt,
      origin: MANUAL_ORIGIN,
      deletedAt: updatedAt,
    };
  }

  return {
    remark,
    updatedAt: coalesceTimestamp(raw.updatedAt, 0),
    origin,
  };
}

function normalizeMap(value: unknown): RemarksMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, record]) => [key, normalizeRecord(record)] as const)
      .filter(
        (entry): entry is readonly [string, VideoRemarkRecord] => !!entry[1],
      ),
  );
}

function normalizeEnvelope(value: unknown): VideoRemarksStorageEnvelope {
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

  const principals: Record<string, PrincipalRemarks> = {};
  if (
    raw.principals &&
    typeof raw.principals === 'object' &&
    !Array.isArray(raw.principals)
  ) {
    for (const [key, value] of Object.entries(
      raw.principals as Record<string, unknown>,
    )) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const principal = value as Record<string, unknown>;
      if (principal.principal !== key) continue;
      principals[key] = {
        principal: key,
        data: normalizeMap(principal.data),
      };
    }
  }

  return {
    version: STORAGE_VERSION,
    legacy: normalizeMap(raw.legacy),
    principals,
  };
}

function readEnvelope(): VideoRemarksStorageEnvelope {
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

function persistEnvelope(next: VideoRemarksStorageEnvelope) {
  cache = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

function notifyRemarkListeners() {
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
    notifyRemarkListeners();

    if (nextPrincipal) {
      syncVideoRemarks().catch(() => {});
    }
  }, 1000);
}

function readPrincipalRemarks(principal: string): RemarksMap {
  return readEnvelope().principals[principal]?.data || {};
}

function writePrincipalRemarks(principal: string, data: RemarksMap) {
  const current = readEnvelope();
  persistEnvelope({
    ...current,
    principals: {
      ...current.principals,
      [principal]: { principal, data },
    },
  });
}

function lookupRemark(
  remarks: RemarksMap,
  identity: ClientRemarkIdentity,
): { record: VideoRemarkRecord; legacyFallback: boolean } | null {
  const primary = remarks[identity.primaryKey];
  if (primary) return { record: primary, legacyFallback: false };

  if (
    !identity.isBangumiSemantic &&
    identity.resolved.migratable &&
    identity.resolved.legacyKey !== identity.primaryKey
  ) {
    const legacy = remarks[identity.resolved.legacyKey];
    if (legacy) return { record: legacy, legacyFallback: true };
  }

  return null;
}

function resolveStoredIdentity(key: string): ClientRemarkIdentity | null {
  const resolved = resolveVideoRemarkIdentity(key);
  if (
    resolved &&
    (key === resolved.canonicalKey || key === resolved.legacyKey)
  ) {
    return {
      resolved,
      primaryKey: resolved.canonicalKey,
      isBangumiSemantic: false,
    };
  }

  if (key.startsWith(BANGUMI_PREFIX) && key.length > BANGUMI_PREFIX.length) {
    return resolveClientRemarkIdentity(
      'bangumi',
      key.slice(BANGUMI_PREFIX.length),
    );
  }

  return null;
}

function normalizeTrustedMap(remarks: RemarksMap): TrustedRemarksMap {
  const normalized = { ...remarks };
  const promotedCanonicalKeys = new Set<string>();
  for (const [key, record] of Object.entries(remarks)) {
    const identity = resolveStoredIdentity(key);
    if (
      identity &&
      identity.primaryKey !== key &&
      !normalized[identity.primaryKey]
    ) {
      normalized[identity.primaryKey] = record;
      promotedCanonicalKeys.add(identity.primaryKey);
    }
  }
  return { data: normalized, promotedCanonicalKeys };
}

function mergeRemarks(
  local: RemarksMap,
  remote: RemarksMap,
  promotedLocalCanonicalKeys: Set<string>,
) {
  const merged: RemarksMap = { ...remote };
  const localWins = new Map<string, UploadCandidate>();

  for (const [key, localRecord] of Object.entries(local)) {
    const remoteRecord = remote[key];
    if (remoteRecord && promotedLocalCanonicalKeys.has(key)) continue;
    if (
      localRecord.origin === BANGUMI_DATE_ORIGIN &&
      remoteRecord &&
      remoteRecord.origin !== BANGUMI_DATE_ORIGIN
    ) {
      continue;
    }

    // 【墓碑重设计·新增·防复活核心】远端墓碑无条件获胜：本地非待上传的
    // 旧副本不允许凭（可能超前的）客户端时间戳反超墓碑。旧实现按时间戳
    // local-wins，另一端删除后本地旧副本时间戳更大就会重传，「删除了
    // 过一会儿又回来」。墓碑代表明确的删除意图，只能被新写入覆盖。
    if (remoteRecord && isTombstone(remoteRecord)) continue;

    if (!remoteRecord || localRecord.updatedAt > remoteRecord.updatedAt) {
      // 【墓碑重设计·新增】本地墓碑仅在远端仍有活记录时才需要上传（传播
      // 删除意图）；远端缺失（记录已被服务端 GC）时不再重放墓碑，否则
      // 每轮 GC 后墓碑都会被重传重生，30 天保留期形同虚设。
      if (isTombstone(localRecord) && !remoteRecord) continue;

      merged[key] = localRecord;
      const identity = resolveStoredIdentity(key);
      if (identity && identity.primaryKey === key) {
        localWins.set(identity.primaryKey, {
          source: identity.resolved.identity.source,
          id: identity.resolved.identity.id,
          record: localRecord,
        });
      }
    }
  }

  return { merged, localWins: Array.from(localWins.values()) };
}

export function getLocalVideoRemark(source: string, id: string) {
  const identity = resolveClientRemarkIdentity(source, id);
  if (!identity) return '';

  const principal = resolvePrincipal();
  if (principal) {
    const principalRemarks = readPrincipalRemarks(principal);
    const scoped = lookupRemark(principalRemarks, identity);
    if (scoped) {
      if (scoped.legacyFallback) {
        writePrincipalRemarks(principal, {
          ...principalRemarks,
          [identity.primaryKey]: scoped.record,
        });
      }
      return scoped.record.remark;
    }
  }

  return lookupRemark(readEnvelope().legacy, identity)?.record.remark || '';
}

export function deleteLocalVideoRemark(source: string, id: string): boolean {
  const principal = resolvePrincipal();
  const identity = resolveClientRemarkIdentity(source, id);
  if (!principal || !identity) return false;

  const next = { ...readPrincipalRemarks(principal) };
  let deleted = false;
  if (Object.prototype.hasOwnProperty.call(next, identity.primaryKey)) {
    delete next[identity.primaryKey];
    deleted = true;
  }

  if (
    !identity.isBangumiSemantic &&
    identity.resolved.migratable &&
    Object.prototype.hasOwnProperty.call(next, identity.resolved.legacyKey)
  ) {
    delete next[identity.resolved.legacyKey];
    deleted = true;
  }

  if (deleted) writePrincipalRemarks(principal, next);
  return deleted;
}

export async function deleteVideoRemark(source: string, id: string) {
  const principal = resolvePrincipal();
  const identity = resolveClientRemarkIdentity(source, id);
  if (!principal || !identity) return false;

  const existing = lookupRemark(readPrincipalRemarks(principal), identity);
  if (existing && existing.record.origin !== MANUAL_ORIGIN) {
    return false;
  }

  // 【墓碑重设计·修改】删除不再本地物理删除记录，而是写入一条本地墓碑
  //（deletedAt），并通过 POST 空 remark + manual origin 通道提交——与保存
  // 共用同一条服务端盖章链路。旧实现（本地删键 + DELETE）：网络失败时本地
  // 已无墓碑，下一次合并只能靠「远端仍缺该键」推断，任何旧副本都会按
  // local-wins 复活。本地墓碑让删除意图在离线/失败窗口内持续可见。
  const deletedAt = Date.now();
  writePrincipalRemarks(principal, {
    ...readPrincipalRemarks(principal),
    [identity.primaryKey]: {
      remark: '',
      updatedAt: deletedAt,
      origin: MANUAL_ORIGIN,
      deletedAt,
    },
  });

  try {
    const response = await fetch('/api/remarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        id,
        remark: '',
        updatedAt: deletedAt,
        origin: MANUAL_ORIGIN,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const serverRecord = normalizeRecord(data?.record);
      // 采纳服务端盖章墓碑（服务端时钟），消除客户端时钟域差异；仅当本地
      // 仍是本次发出的墓碑时采纳，防止覆盖请求期间的更新编辑。
      const current = readPrincipalRemarks(principal)[identity.primaryKey];
      if (
        resolvePrincipal() === principal &&
        serverRecord &&
        isTombstone(serverRecord) &&
        current &&
        current.updatedAt === deletedAt
      ) {
        writePrincipalRemarks(principal, {
          ...readPrincipalRemarks(principal),
          [identity.primaryKey]: serverRecord,
        });
      }
    }
  } catch {
    // 离线删除：保留本地墓碑，后续 syncVideoRemarks 合并时按墓碑规则上传传播。
  }

  return true;
}

export function subscribeVideoRemarks(listener: () => void) {
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

export async function syncVideoRemarks() {
  installSyncListeners();
  const principal = resolvePrincipal();
  if (!principal) return readEnvelope().legacy;

  const active = syncPromises.get(principal);
  if (active) return active;

  const promise = (async () => {
    const local = normalizeTrustedMap(readPrincipalRemarks(principal));
    const response = await fetch('/api/remarks', { cache: 'no-store' });
    if (!response.ok)
      throw new Error(`sync remarks failed: ${response.status}`);
    if (resolvePrincipal() !== principal) return local.data;

    const remote = normalizeTrustedMap(normalizeMap(await response.json()));
    const { merged, localWins } = mergeRemarks(
      local.data,
      remote.data,
      local.promotedCanonicalKeys,
    );
    writePrincipalRemarks(principal, merged);

    if (resolvePrincipal() !== principal) return merged;

    // 【复查加固·修改】重放上传不再「发射后不管」：收集服务端盖章响应并在
    // 上传后采纳落库记录。旧实现不读响应，本地时间戳停留在客户端时钟域：
    // 时钟超前的端每轮 sync 都满足 localRecord.updatedAt >
    // remoteRecord.updatedAt 而重复上传同一条记录（时钟偏差多久就重传多久），
    // 且期间本端旧内容会压掉其他设备对同一备注的新编辑。采纳盖章后本地与
    // 服务端时钟域对齐，一次收敛、不再重传（与 App 端 _syncFromServer 的
    // adoptions 机制对齐，补齐契约「上传一次自愈，采纳服务端盖章收敛」的
    // Web 半边）。
    const uploads = await Promise.all(
      localWins.map(async ({ source, id, record }) => {
        try {
          const response = await fetch('/api/remarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source,
              id,
              remark: record.remark,
              updatedAt: record.updatedAt,
              origin: record.origin,
            }),
          });
          if (!response.ok) return;
          const data = await response.json();
          return {
            source,
            id,
            record,
            serverRecord: normalizeRecord(data?.record),
          };
        } catch {
          // 单条上传失败（离线/网络抖动）：保持本地乐观记录，下一轮 sync
          // 继续（远端缺失或时间戳落后的活记录仍会触发重传，无需额外标记）。
        }
      }),
    );

    // 采纳服务端盖章（含 ignored 响应——服务端现有记录即权威状态，采纳即
    // 正确收敛）。still-sent 守卫：本地仍是本次发送的那条乐观记录（时间戳
    // 未变）才覆盖，防止吞掉上传窗口内用户的新编辑；与 saveVideoRemark 的
    // 采纳守卫同一范式。
    if (resolvePrincipal() === principal) {
      let next = readPrincipalRemarks(principal);
      let changed = false;
      for (const upload of uploads) {
        if (!upload || !upload.serverRecord) continue;
        const identity = resolveClientRemarkIdentity(upload.source, upload.id);
        if (!identity) continue;
        const current = next[identity.primaryKey];
        if (current && current.updatedAt === upload.record.updatedAt) {
          next = { ...next, [identity.primaryKey]: upload.serverRecord };
          changed = true;
        }
      }
      if (changed) writePrincipalRemarks(principal, next);
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

function installSyncListeners() {
  if (syncListenersInstalled || typeof window === 'undefined') return;
  syncListenersInstalled = true;

  window.addEventListener('focus', () => {
    syncVideoRemarks().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncVideoRemarks().catch(() => {});
    }
  });
}

export async function saveVideoRemark(
  source: string,
  id: string,
  remark: string,
) {
  const principal = resolvePrincipal();
  const identity = resolveClientRemarkIdentity(source, id);
  if (!principal || !identity) return;

  // 【复查加固·新增】空备注 = 删除意图，转发到删除通道（与 App 端
  // saveRemark → deleteRemark 的行为对齐）。旧实现会本地写一条无
  // deletedAt 的空 manual 记录并直接 POST：非 UI 调用方借此会绕过
  // bangumi origin 守卫、用空保存覆盖掉自动日期备注（App 端有守卫，Web
  // 缺失）。deleteVideoRemark 自带的守卫与墓碑通道补齐这个缺口。UI
  //（VideoCard）此前已自行把空输入路由到删除，无行为变化。
  if (!remark.trim()) {
    await deleteVideoRemark(source, id);
    return;
  }

  const key = identity.primaryKey;
  const record: VideoRemarkRecord = {
    remark: remark.trim(),
    updatedAt: Date.now(),
    origin: MANUAL_ORIGIN,
  };

  writePrincipalRemarks(principal, {
    ...readPrincipalRemarks(principal),
    [key]: record,
  });

  try {
    const response = await fetch('/api/remarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        id,
        remark: record.remark,
        updatedAt: record.updatedAt,
        origin: record.origin,
      }),
    });

    if (!response.ok) return;

    const data = await response.json();
    const serverRecord = normalizeRecord(data?.record);
    // 【墓碑重设计·修改】服务端现在统一用服务端时钟盖章并返回落库记录；
    // 只要本地仍是本次发出的乐观记录（未被请求期间的新编辑覆盖）就采纳
    // 服务端时间戳。旧实现按「服务端时间戳 > 本地时间戳」判断，在客户端
    // 时钟超前时永远不采纳，本地副本会每轮 sync 重复上传同一记录。
    // ignored 响应（旧后端的 staleness 守卫/bangumi 守卫）不采纳，避免
    // 把服务器上的旧内容覆盖掉用户刚输入的新内容。
    const current = readPrincipalRemarks(principal)[key];
    if (
      resolvePrincipal() === principal &&
      data?.ignored !== true &&
      serverRecord &&
      !isTombstone(serverRecord) &&
      current &&
      current.updatedAt === record.updatedAt
    ) {
      writePrincipalRemarks(principal, {
        ...readPrincipalRemarks(principal),
        [key]: serverRecord,
      });
    }
  } catch {
    // Offline edits remain in the current principal namespace for later sync.
  }
}

export async function saveBangumiDateRemarkIfAllowed(
  source: string,
  id: string,
  date: string | null | undefined,
) {
  const remark = date?.trim() || '';
  const principal = resolvePrincipal();
  const identity = resolveClientRemarkIdentity(source, id);
  if (!remark || !principal || !identity) return;

  const key = identity.primaryKey;
  const existing = lookupRemark(readPrincipalRemarks(principal), identity);
  if (existing && existing.record.origin !== BANGUMI_DATE_ORIGIN) return;

  const record: VideoRemarkRecord = {
    remark,
    updatedAt: Date.now(),
    origin: BANGUMI_DATE_ORIGIN,
  };

  try {
    const response = await fetch('/api/remarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        id,
        remark: record.remark,
        updatedAt: record.updatedAt,
        origin: record.origin,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const serverRecord = normalizeRecord(data?.record);
      if (resolvePrincipal() === principal && serverRecord) {
        writePrincipalRemarks(principal, {
          ...readPrincipalRemarks(principal),
          [key]: serverRecord,
        });
        return;
      }
    }
  } catch {
    // Fall back to the current principal namespace below.
  }

  const latest = readPrincipalRemarks(principal);
  const latestExisting = lookupRemark(latest, identity);
  if (latestExisting && latestExisting.record.origin !== BANGUMI_DATE_ORIGIN) {
    return;
  }

  writePrincipalRemarks(principal, {
    ...latest,
    [key]: record,
  });
}

export async function pushVideoRemarkToAll(source?: string, id?: string) {
  const response = await fetch('/api/admin/remarks/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source && id ? { source, id } : {}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `push remarks failed: ${response.status}`);
  }

  return data as {
    success: boolean;
    sourceRecords: number;
    updatedUsers: number;
    insertedRecords: number;
  };
}
