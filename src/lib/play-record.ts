import {
  buildContentIdentityKey,
  resolveContentIdentity,
} from './content-identity';

export interface PlayRecordIdentity {
  source: string;
  id: string;
  isLegacy: boolean;
}

export function playRecordStorageKey(source: string, id: string): string {
  return buildContentIdentityKey(source, id);
}

export function legacyPlayRecordStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

export function parsePlayRecordStorageKey(
  key: string,
): PlayRecordIdentity | null {
  const identity = resolveContentIdentity(key);
  if (!identity) return null;

  return {
    source: identity.source,
    id: identity.id,
    isLegacy: key !== identity.identityKey,
  };
}

export function normalizePlayRecordKeys<T>(records: Record<string, T>): {
  records: Record<string, T>;
  changed: boolean;
} {
  const normalized: Record<string, T> = {};
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
    if (!(key in normalized)) normalized[key] = record;
  }

  const originalKeys = Object.keys(records);
  const normalizedKeys = Object.keys(normalized);
  const changed =
    originalKeys.length !== normalizedKeys.length ||
    originalKeys.some((key) => !(key in normalized));
  return { records: normalized, changed };
}

export function playbackFactsOnly<T extends { original_episodes?: unknown }>(
  record: T,
): Omit<T, 'original_episodes'> {
  const facts = { ...record } as T & { original_episodes?: unknown };
  delete facts.original_episodes;
  return facts as Omit<T, 'original_episodes'>;
}
