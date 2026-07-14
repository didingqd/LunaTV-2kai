import { AdminConfig } from '@/lib/admin.types';
import { db } from '@/lib/db';

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

export function buildRemarkKey(source: string, id: string) {
  return `${source.trim()}__${id.trim()}`;
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

    const target = await readRemarks(username);
    let changed = false;

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
      changed = true;
      insertedRecords++;
    }

    if (changed) {
      await writeRemarks(username, target);
      updatedUsers++;
    }
  }

  return {
    sourceRecords: sourceEntries.length,
    updatedUsers,
    insertedRecords,
  };
}
