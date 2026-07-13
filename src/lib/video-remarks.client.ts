export type VideoRemarkRecord = {
  remark: string;
  updatedAt: number;
};

type RemarksMap = Record<string, VideoRemarkRecord>;

const STORAGE_KEY = 'moontv_video_card_remarks';

let cache: RemarksMap | null = null;
let syncPromise: Promise<RemarksMap> | null = null;
let syncListenersInstalled = false;
const listeners = new Set<() => void>();

export function videoRemarkKey(source: string, id: string) {
  return `${source.trim()}__${id.trim()}`;
}

function normalizeRecord(value: unknown): VideoRemarkRecord | null {
  if (typeof value === 'string') {
    return { remark: value.trim(), updatedAt: 0 };
  }

  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const remark = typeof raw.remark === 'string' ? raw.remark.trim() : '';
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : 0;

  return { remark, updatedAt };
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
