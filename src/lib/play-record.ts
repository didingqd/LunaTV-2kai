export interface PlayRecordIdentity {
  source: string;
  id: string;
  isLegacy: boolean;
}

export function playRecordStorageKey(source: string, id: string): string {
  return encodeURIComponent(JSON.stringify([source, id]));
}

export function legacyPlayRecordStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

export function parsePlayRecordStorageKey(
  key: string,
): PlayRecordIdentity | null {
  try {
    const decoded = JSON.parse(decodeURIComponent(key)) as unknown;
    if (
      Array.isArray(decoded) &&
      decoded.length === 2 &&
      typeof decoded[0] === 'string' &&
      decoded[0].length > 0 &&
      typeof decoded[1] === 'string' &&
      decoded[1].length > 0
    ) {
      return { source: decoded[0], id: decoded[1], isLegacy: false };
    }
  } catch {
    // Fall through to the legacy source+id parser.
  }

  const separator = key.indexOf('+');
  if (separator <= 0 || separator === key.length - 1) return null;
  return {
    source: key.slice(0, separator),
    id: key.slice(separator + 1),
    isLegacy: true,
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
