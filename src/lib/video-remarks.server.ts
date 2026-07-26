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
};

export type RemarksMap = Record<string, RemarkRecord>;

export const MANUAL_ORIGIN: RemarkOrigin = 'manual';
export const BANGUMI_DATE_ORIGIN: RemarkOrigin = 'bangumi_date';

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
  if (!remark && origin !== MANUAL_ORIGIN) return null;

  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : 0;

  return { remark, updatedAt, origin };
}

export function normalizeRemarks(value: unknown): RemarksMap {
  if (!value || typeof value !== 'object') return {};

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, record]) => [key, normalizeRecord(record)] as const)
    .filter((entry): entry is readonly [string, RemarkRecord] => !!entry[1]);

  return Object.fromEntries(entries);
}

export function manualRemarksOnly(remarks: RemarksMap): RemarksMap {
  return Object.fromEntries(
    Object.entries(remarks).filter(
      ([, record]) => record.origin === MANUAL_ORIGIN && record.remark.trim(),
    ),
  );
}

export async function readRemarks(username: string): Promise<RemarksMap> {
  return normalizeRemarks(await db.getCache(remarksCacheKey(username)));
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

        target[key] = {
          ...record,
          updatedAt: Date.now(),
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
