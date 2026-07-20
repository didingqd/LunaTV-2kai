import {
  buildContentIdentityKey,
  resolveContentIdentity,
  type ContentIdentity,
} from './content-identity';

const SEMANTIC_ID = '__identity__';
// ContentIdentity requires a non-empty id, so the empty SQLite column is safe
// as an internal marker without changing the table schema.
const CONTENT_STORAGE_ID = '';

export type SkipConfigIdentityKind = 'content' | 'semantic';

export interface SkipConfigIdentity {
  kind: SkipConfigIdentityKind;
  source: string;
  id: string;
  storageKey: string;
  contentIdentity?: ContentIdentity;
  semanticKey?: string;
  legacyKey?: string;
}

export interface SkipConfigIdentityMigration<T> {
  storedKey: string;
  storageKey: string;
  value: T;
  writeCanonical: boolean;
}

export function normalizeSkipConfigIdentity(
  input: unknown,
  id?: unknown,
  semanticIdentityKey?: unknown,
): SkipConfigIdentity | null {
  const semantic = normalizeSemanticIdentity(semanticIdentityKey);
  if (semantic) return semantic;

  if (id !== undefined) {
    const semanticFromFields =
      typeof input === 'string' && id === SEMANTIC_ID
        ? normalizeSemanticIdentity(input)
        : null;
    if (semanticFromFields) return semanticFromFields;

    const content = resolveContentIdentity({ source: input, id });
    return content ? createContentIdentity(content) : null;
  }

  if (typeof input === 'string') {
    return resolveSkipConfigIdentityKey(input);
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const embeddedSemantic = normalizeSemanticIdentity(raw.identityKey);
  if (embeddedSemantic) return embeddedSemantic;

  const content = resolveContentIdentity({
    source: raw.source,
    id: raw.id,
    sourceKey: raw.sourceKey,
    videoId: raw.videoId,
    identityKey: raw.identityKey,
  });
  if (content) return createContentIdentity(content);

  if (typeof raw.key === 'string') {
    return resolveSkipConfigIdentityKey(raw.key);
  }

  return null;
}

export function buildSkipConfigKey(
  source: string,
  id: string,
  semanticIdentityKey?: string,
): string {
  const semantic = normalizeSemanticIdentity(semanticIdentityKey);
  if (semantic) return semantic.storageKey;
  const semanticFromFields =
    id === SEMANTIC_ID ? normalizeSemanticIdentity(source) : null;
  if (semanticFromFields) return semanticFromFields.storageKey;
  return buildContentIdentityKey(source, id);
}

export function compareSkipConfigIdentity(
  left: unknown,
  right: unknown,
): boolean {
  const leftIdentity = normalizeSkipConfigIdentityValue(left);
  const rightIdentity = normalizeSkipConfigIdentityValue(right);
  return (
    leftIdentity !== null &&
    rightIdentity !== null &&
    leftIdentity.storageKey === rightIdentity.storageKey
  );
}

/**
 * Legacy keys are only accepted when the separator is unambiguous.
 * A key with more than one '+' cannot tell whether the source or id owns it.
 */
export function resolveLegacySkipConfigKey(
  key: string,
): SkipConfigIdentity | null {
  const semantic = normalizeSemanticIdentityKey(key);
  if (semantic) return semantic;

  const first = key.indexOf('+');
  if (first <= 0 || first !== key.lastIndexOf('+')) return null;

  const source = key.slice(0, first);
  const id = key.slice(first + 1);
  if (!source || !id) return null;

  const content = resolveContentIdentity({ source, id });
  return content ? createContentIdentity(content, key) : null;
}

export function resolveSkipConfigIdentityKey(
  key: string,
): SkipConfigIdentity | null {
  const canonical = resolveContentIdentity(key);
  if (canonical && key === canonical.identityKey) {
    return createContentIdentity(canonical);
  }

  return resolveLegacySkipConfigKey(key);
}

export function isSemanticSkipConfigIdentity(value: string): boolean {
  return isSemanticIdentityKey(value);
}

export function normalizeSkipConfigRecord<T>(values: Record<string, T>): {
  values: Record<string, T>;
  migrations: SkipConfigIdentityMigration<T>[];
  changed: boolean;
} {
  const normalized: Record<string, T> = {};
  const legacyEntries: Array<{
    storedKey: string;
    identity: SkipConfigIdentity;
    value: T;
  }> = [];

  for (const [storedKey, value] of Object.entries(values)) {
    const identity = resolveSkipConfigIdentityKey(storedKey);
    if (!identity) {
      normalized[storedKey] = value;
      continue;
    }

    if (storedKey === identity.storageKey) {
      normalized[identity.storageKey] = value;
    } else {
      legacyEntries.push({ storedKey, identity, value });
    }
  }

  const migrations = legacyEntries.map(({ storedKey, identity, value }) => {
    const writeCanonical = !Object.prototype.hasOwnProperty.call(
      normalized,
      identity.storageKey,
    );
    if (writeCanonical) normalized[identity.storageKey] = value;
    return {
      storedKey,
      storageKey: identity.storageKey,
      value,
      writeCanonical,
    };
  });

  return {
    values: normalized,
    migrations,
    changed: migrations.length > 0,
  };
}

export function contentStorageIdentity(
  source: string,
  id: string,
): { source: string; id: string } {
  const content = resolveContentIdentity({ source, id });
  if (!content) throw new Error('Invalid SkipConfig content identity');
  return { source: content.identityKey, id: CONTENT_STORAGE_ID };
}

export function skipConfigStorageIdentity(
  source: string,
  id: string,
): { source: string; id: string } {
  const identity = normalizeSkipConfigIdentity(source, id);
  if (!identity) throw new Error('Invalid SkipConfig identity');
  if (identity.kind === 'semantic') {
    return { source: identity.source, id: identity.id };
  }
  return contentStorageIdentity(identity.source, identity.id);
}

export function resolveSkipConfigStorageIdentity(
  source: string,
  id: string,
): SkipConfigIdentity | null {
  if (id === CONTENT_STORAGE_ID) {
    const content = resolveContentIdentity(source);
    return content && source === content.identityKey
      ? createContentIdentity(content)
      : null;
  }
  return normalizeSkipConfigIdentity(source, id);
}

export function legacySkipConfigKey(source: string, id: string): string | null {
  if (source.includes('+') || id.includes('+')) return null;
  return `${source}+${id}`;
}

export function semanticSkipConfigIdentity(identityKey: string): {
  source: string;
  id: string;
} | null {
  const semantic = normalizeSemanticIdentity(identityKey);
  return semantic ? { source: semantic.source, id: semantic.id } : null;
}

function normalizeSkipConfigIdentityValue(
  value: unknown,
): SkipConfigIdentity | null {
  if (typeof value === 'string') return resolveSkipConfigIdentityKey(value);

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    return normalizeSkipConfigIdentity(
      raw,
      undefined,
      raw.semanticKey ?? raw.identityKey,
    );
  }

  return null;
}

function createContentIdentity(
  content: ContentIdentity,
  legacyKey?: string,
): SkipConfigIdentity {
  return {
    kind: 'content',
    source: content.source,
    id: content.id,
    storageKey: content.identityKey,
    contentIdentity: content,
    legacyKey:
      legacyKey ?? legacySkipConfigKey(content.source, content.id) ?? undefined,
  };
}

function normalizeSemanticIdentity(value: unknown): SkipConfigIdentity | null {
  if (typeof value !== 'string' || !isSemanticIdentityKey(value)) return null;
  return {
    kind: 'semantic',
    source: value,
    id: SEMANTIC_ID,
    storageKey: `${value}+${SEMANTIC_ID}`,
    semanticKey: value,
  };
}

function normalizeSemanticIdentityKey(key: string): SkipConfigIdentity | null {
  if (!key.endsWith(`+${SEMANTIC_ID}`)) return null;
  const semanticKey = key.slice(0, -`+${SEMANTIC_ID}`.length);
  return normalizeSemanticIdentity(semanticKey);
}

function isSemanticIdentityKey(value: string): boolean {
  return (
    (value.startsWith('douban:') || value.startsWith('title:')) &&
    value.length > value.indexOf(':') + 1
  );
}
