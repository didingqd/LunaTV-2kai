export type VideoRemarkRecord = {
  remark: string;
  updatedAt: number;
  origin: VideoRemarkOrigin;
};

type RemarksMap = Record<string, VideoRemarkRecord>;
type VideoRemarkOrigin = 'manual' | 'bangumi_date';

const STORAGE_KEY = 'moontv_video_card_remarks';
const MANUAL_ORIGIN: VideoRemarkOrigin = 'manual';
const BANGUMI_DATE_ORIGIN: VideoRemarkOrigin = 'bangumi_date';

let cache: RemarksMap | null = null;
let syncPromise: Promise<RemarksMap> | null = null;
let syncListenersInstalled = false;
const listeners = new Set<() => void>();

export function videoRemarkKey(source: string, id: string) {
  return `${source.trim()}__${id.trim()}`;
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
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, record]) => [key, normalizeRecord(record)] as const)
      .filter(
        (entry): entry is readonly [string, VideoRemarkRecord] => !!entry[1],
      ),
  );
}

function readLocal(): RemarksMap {
  if (typeof window === 'undefined') return {};
  if (cache) return cache;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? normalizeMap(JSON.parse(raw)) : {};
  } catch {
    cache = {};
  }

  return cache;
}

function writeLocal(next: RemarksMap) {
  cache = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

function mergeRemarks(local: RemarksMap, remote: RemarksMap) {
  const merged: RemarksMap = { ...remote };
  const localWins: Array<[string, VideoRemarkRecord]> = [];

  for (const [key, localRecord] of Object.entries(local)) {
    const remoteRecord = remote[key];
    if (
      localRecord.origin === BANGUMI_DATE_ORIGIN &&
      remoteRecord &&
      remoteRecord.origin !== BANGUMI_DATE_ORIGIN
    ) {
      continue;
    }

    if (!remoteRecord || localRecord.updatedAt > remoteRecord.updatedAt) {
      merged[key] = localRecord;
      localWins.push([key, localRecord]);
    }
  }

  return { merged, localWins };
}

export function getLocalVideoRemark(source: string, id: string) {
  const record = readLocal()[videoRemarkKey(source, id)];
  return record?.remark || '';
}

export function subscribeVideoRemarks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function syncVideoRemarks() {
  installSyncListeners();
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const local = readLocal();
    const response = await fetch('/api/remarks', { cache: 'no-store' });
    if (!response.ok)
      throw new Error(`sync remarks failed: ${response.status}`);

    const remote = normalizeMap(await response.json());
    const { merged, localWins } = mergeRemarks(local, remote);
    writeLocal(merged);

    await Promise.allSettled(
      localWins.map(([key, record]) => {
        const separator = key.indexOf('__');
        if (separator <= 0) return Promise.resolve();

        return fetch('/api/remarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: key.slice(0, separator),
            id: key.slice(separator + 2),
            remark: record.remark,
            updatedAt: record.updatedAt,
            origin: record.origin,
          }),
        });
      }),
    );

    return merged;
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
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
  const key = videoRemarkKey(source, id);
  const record: VideoRemarkRecord = {
    remark: remark.trim(),
    updatedAt: Date.now(),
    origin: MANUAL_ORIGIN,
  };

  writeLocal({
    ...readLocal(),
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
    if (serverRecord && serverRecord.updatedAt > record.updatedAt) {
      writeLocal({
        ...readLocal(),
        [key]: serverRecord,
      });
    }
  } catch {
    // Offline edits remain in localStorage and will be reconciled on next sync.
  }
}

export async function saveBangumiDateRemarkIfAllowed(
  source: string,
  id: string,
  date: string | null | undefined,
) {
  const remark = date?.trim() || '';
  if (!remark) return;

  const key = videoRemarkKey(source, id);
  const existing = readLocal()[key];
  if (existing && existing.origin !== BANGUMI_DATE_ORIGIN) return;

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
      if (serverRecord) {
        writeLocal({
          ...readLocal(),
          [key]: serverRecord,
        });
        return;
      }
    }
  } catch {
    // Fall back to local-only auto remark below.
  }

  const latest = readLocal();
  const latestExisting = latest[key];
  if (latestExisting && latestExisting.origin !== BANGUMI_DATE_ORIGIN) return;

  writeLocal({
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
