import {
  compareContentIdentity,
  normalizeContentIdentity,
  resolveContentIdentity,
  type ContentIdentity,
} from './content-identity';

export type VideoRemarkIdentityFormat = 'canonical' | 'legacy' | 'fields';

export interface VideoRemarkIdentity {
  identity: ContentIdentity;
  canonicalKey: string;
  legacyKey: string;
  migratable: boolean;
  format: VideoRemarkIdentityFormat;
}

function buildLegacyKey(identity: ContentIdentity): string {
  return `${identity.source}__${identity.id}`;
}

function isSafeLegacyKey(key: string): boolean {
  const separator = key.indexOf('__');
  return (
    separator > 0 &&
    separator === key.lastIndexOf('__') &&
    separator < key.length - 2 &&
    !key.startsWith('bangumi__')
  );
}

function resolveLegacyKey(key: string): ContentIdentity | null {
  if (!isSafeLegacyKey(key)) return null;

  const separator = key.indexOf('__');
  return normalizeContentIdentity(
    key.slice(0, separator),
    key.slice(separator + 2),
  );
}

function toResult(
  identity: ContentIdentity,
  format: VideoRemarkIdentityFormat,
): VideoRemarkIdentity {
  const legacyKey = buildLegacyKey(identity);
  return {
    identity,
    canonicalKey: identity.identityKey,
    legacyKey,
    migratable: isSafeLegacyKey(legacyKey),
    format,
  };
}

export function resolveVideoRemarkIdentity(
  input: unknown,
): VideoRemarkIdentity | null {
  if (typeof input === 'string') {
    const canonical = resolveContentIdentity(input);
    if (canonical) return toResult(canonical, 'canonical');

    const legacy = resolveLegacyKey(input);
    return legacy ? toResult(legacy, 'legacy') : null;
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const raw = input as Record<string, unknown>;

  if (raw.identity && typeof raw.identity === 'object') {
    const nested = resolveContentIdentity(raw.identity);
    if (nested) return toResult(nested, 'canonical');
  }

  const direct = resolveContentIdentity(raw);
  if (direct) {
    const format =
      typeof raw.source === 'string' && typeof raw.id === 'string'
        ? 'fields'
        : 'canonical';
    return toResult(direct, format);
  }

  if (typeof raw.identityKey === 'string') {
    const canonical = resolveContentIdentity(raw.identityKey);
    if (canonical) return toResult(canonical, 'canonical');
  }

  if (typeof raw.key === 'string') {
    const canonical = resolveContentIdentity(raw.key);
    if (canonical) return toResult(canonical, 'canonical');

    const legacy = resolveLegacyKey(raw.key);
    return legacy ? toResult(legacy, 'legacy') : null;
  }

  return null;
}

export function normalizeVideoRemarkIdentity(
  input: unknown,
  id?: unknown,
): VideoRemarkIdentity | null {
  if (id !== undefined) {
    const identity = normalizeContentIdentity(input, id);
    return identity ? toResult(identity, 'fields') : null;
  }

  return resolveVideoRemarkIdentity(input);
}

export function buildVideoRemarkKey(source: string, id: string): string;
export function buildVideoRemarkKey(input: unknown): string | null;
export function buildVideoRemarkKey(
  sourceOrInput: unknown,
  id?: unknown,
): string | null {
  const identity = normalizeVideoRemarkIdentity(sourceOrInput, id);
  return identity?.canonicalKey ?? null;
}

export function compareVideoRemarkIdentity(
  left: unknown,
  right: unknown,
): boolean {
  const leftIdentity = resolveVideoRemarkIdentity(left);
  const rightIdentity = resolveVideoRemarkIdentity(right);

  return (
    leftIdentity !== null &&
    rightIdentity !== null &&
    compareContentIdentity(leftIdentity.identity, rightIdentity.identity)
  );
}
