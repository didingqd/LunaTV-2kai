import {
  buildPlayRecordKey,
  normalizePlayRecordIdentity,
  resolvePlayRecordIdentity,
} from './play-record-identity';

export interface PlayRecordIdentity {
  source: string;
  id: string;
  isLegacy: boolean;
}

export function playRecordStorageKey(source: string, id: string): string {
  return buildPlayRecordKey(source, id);
}

export function legacyPlayRecordStorageKey(
  source: string,
  id: string,
): string | null {
  return normalizePlayRecordIdentity(source, id)?.legacyKey ?? null;
}

export function parsePlayRecordStorageKey(
  key: string,
): PlayRecordIdentity | null {
  const identity = resolvePlayRecordIdentity(key);
  if (!identity) return null;

  return {
    source: identity.source,
    id: identity.id,
    isLegacy: identity.format === 'legacy',
  };
}

export function normalizePlayRecordKeys<T>(records: Record<string, T>): {
  records: Record<string, T>;
  storageRecords: Record<string, T>;
  changed: boolean;
} {
  const normalized: Record<string, T> = {};
  const storageRecords: Record<string, T> = { ...records };
  const legacyEntries: Array<[PlayRecordIdentity, T]> = [];

  for (const [key, record] of Object.entries(records)) {
    const identity = parsePlayRecordStorageKey(key);
    if (!identity) continue;
    if (identity.isLegacy) {
      legacyEntries.push([identity, record]);
      continue;
    }
    normalized[playRecordStorageKey(identity.source, identity.id)] = record;
  }

  for (const [identity, record] of legacyEntries) {
    const key = playRecordStorageKey(identity.source, identity.id);
    if (!(key in normalized)) {
      normalized[key] = record;
      storageRecords[key] = record;
    }
  }

  const changed = Object.keys(storageRecords).some(
    (key) => !Object.prototype.hasOwnProperty.call(records, key),
  );
  return { records: normalized, storageRecords, changed };
}

export function playbackFactsOnly<T extends { original_episodes?: unknown }>(
  record: T,
): Omit<T, 'original_episodes'> {
  const facts = { ...record } as T & { original_episodes?: unknown };
  delete facts.original_episodes;
  return facts as Omit<T, 'original_episodes'>;
}
