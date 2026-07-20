export interface ContentIdentity {
  source: string;
  id: string;
  identityKey: string;
}

export interface ContentIdentityInput {
  source?: unknown;
  id?: unknown;
  sourceKey?: unknown;
  videoId?: unknown;
  identityKey?: unknown;
  key?: unknown;
}

export function buildContentIdentityKey(source: string, id: string): string {
  return encodeURIComponent(JSON.stringify([source, id]));
}

export function resolveContentIdentity(input: unknown): ContentIdentity | null {
  if (typeof input === 'string') {
    return parseCanonicalKey(input) ?? parseLegacyPlayRecordKey(input);
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const raw = input as ContentIdentityInput;

  const direct = createContentIdentity(raw.source, raw.id);
  if (direct) return direct;

  if (typeof raw.identityKey === 'string') {
    const canonical = parseCanonicalKey(raw.identityKey);
    if (canonical) return canonical;
  }

  const legacyFields = createContentIdentity(raw.sourceKey, raw.videoId);
  if (legacyFields) return legacyFields;

  if (typeof raw.key === 'string') {
    return parseCanonicalKey(raw.key) ?? parseLegacyPlayRecordKey(raw.key);
  }

  return null;
}

export function normalizeContentIdentity(
  input: unknown,
  id?: unknown,
): ContentIdentity | null {
  if (id !== undefined) return createContentIdentity(input, id);
  return resolveContentIdentity(input);
}

export function compareContentIdentity(left: unknown, right: unknown): boolean {
  const leftIdentity = resolveContentIdentity(left);
  const rightIdentity = resolveContentIdentity(right);

  return (
    leftIdentity !== null &&
    rightIdentity !== null &&
    leftIdentity.identityKey === rightIdentity.identityKey
  );
}

function createContentIdentity(
  source: unknown,
  id: unknown,
): ContentIdentity | null {
  if (!isNonEmptyString(source) || !isNonEmptyString(id)) return null;

  return {
    source,
    id,
    identityKey: buildContentIdentityKey(source, id),
  };
}

function parseCanonicalKey(key: string): ContentIdentity | null {
  try {
    const decoded = JSON.parse(decodeURIComponent(key)) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    return createContentIdentity(decoded[0], decoded[1]);
  } catch {
    return null;
  }
}

function parseLegacyPlayRecordKey(key: string): ContentIdentity | null {
  const separator = key.indexOf('+');
  if (separator <= 0 || separator === key.length - 1) return null;

  return createContentIdentity(
    key.slice(0, separator),
    key.slice(separator + 1),
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
