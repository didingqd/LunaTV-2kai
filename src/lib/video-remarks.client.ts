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
let principalWatcherHandle: ReturnType<typeof setInterval> | null = null;
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

function normalizeRecord(value: unknown): VideoRemarkRecord | null {
  if (typeof value === 'string') {
    return { remark: value.trim(), updatedAt: 0, origin: MANUAL_ORIGIN };
  }

  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const remark = typeof raw.remark === 'string' ? raw.remark.trim() : '';
  const origin = normalizeOrigin(raw.origin);
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : 0;

  return { remark, updatedAt, origin };
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

    if (!remoteRecord || localRecord.updatedAt > remoteRecord.updatedAt) {
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

    await Promise.allSettled(
      localWins.map(({ source, id, record }) =>
        fetch('/api/remarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            id,
            remark: record.remark,
            updatedAt: record.updatedAt,
            origin: record.origin,
          }),
        }),
      ),
    );

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
    if (
      resolvePrincipal() === principal &&
      serverRecord &&
      serverRecord.updatedAt > record.updatedAt
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
