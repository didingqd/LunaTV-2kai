import {
  compareContentIdentity,
  normalizeContentIdentity,
  resolveContentIdentity,
  type ContentIdentity,
} from './content-identity';

export type PlayRecordIdentityFormat = 'canonical' | 'legacy' | 'fields';
export type PlayRecordLegacyFailureReason = 'ambiguous' | 'invalid';

export interface PlayRecordIdentity {
  identity: ContentIdentity;
  source: string;
  id: string;
  canonicalKey: string;
  legacyKey?: string;
  format: PlayRecordIdentityFormat;
  migratable: boolean;
}

export type LegacyPlayRecordKeyResult =
  | {
      identity: PlayRecordIdentity;
      legacyKey: string;
      migratable: true;
    }
  | {
      identity: null;
      legacyKey: string;
      migratable: false;
      reason: PlayRecordLegacyFailureReason;
    };

function safeLegacyKey(identity: ContentIdentity): string | undefined {
  if (identity.source.includes('+') || identity.id.includes('+')) {
    return undefined;
  }
  return `${identity.source}+${identity.id}`;
}

function toResult(
  identity: ContentIdentity,
  format: PlayRecordIdentityFormat,
  legacyKey?: string,
): PlayRecordIdentity {
  return {
    identity,
    source: identity.source,
    id: identity.id,
    canonicalKey: identity.identityKey,
    legacyKey: legacyKey ?? safeLegacyKey(identity),
    format,
    migratable: format !== 'legacy' || legacyKey !== undefined,
  };
}

export function parseLegacyPlayRecordKey(
  key: string,
): LegacyPlayRecordKeyResult {
  const separator = key.indexOf('+');
  if (separator !== key.lastIndexOf('+')) {
    return {
      identity: null,
      legacyKey: key,
      migratable: false,
      reason: 'ambiguous',
    };
  }

  if (separator <= 0 || separator >= key.length - 1) {
    return {
      identity: null,
      legacyKey: key,
      migratable: false,
      reason: 'invalid',
    };
  }

  const identity = normalizeContentIdentity(
    key.slice(0, separator),
    key.slice(separator + 1),
  );
  if (!identity) {
    return {
      identity: null,
      legacyKey: key,
      migratable: false,
      reason: 'invalid',
    };
  }

  return {
    identity: toResult(identity, 'legacy', key),
    legacyKey: key,
    migratable: true,
  };
}

export function resolvePlayRecordIdentity(
  input: unknown,
): PlayRecordIdentity | null {
  if (typeof input === 'string') {
    const canonical = resolveContentIdentity(input);
    if (canonical && input === canonical.identityKey) {
      return toResult(canonical, 'canonical');
    }

    const legacy = parseLegacyPlayRecordKey(input);
    return legacy.migratable ? legacy.identity : null;
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const direct = normalizeContentIdentity(raw.source, raw.id);
  if (direct) return toResult(direct, 'fields');

  const compatibilityFields = normalizeContentIdentity(
    raw.sourceKey,
    raw.videoId,
  );
  if (compatibilityFields) return toResult(compatibilityFields, 'fields');

  if (typeof raw.identityKey === 'string') {
    const canonical = resolvePlayRecordIdentity(raw.identityKey);
    if (canonical?.format === 'canonical') return canonical;
  }

  if (typeof raw.key === 'string') {
    return resolvePlayRecordIdentity(raw.key);
  }

  return null;
}

export function normalizePlayRecordIdentity(
  input: unknown,
  id?: unknown,
): PlayRecordIdentity | null {
  if (id !== undefined) {
    const identity = normalizeContentIdentity(input, id);
    return identity ? toResult(identity, 'fields') : null;
  }
  return resolvePlayRecordIdentity(input);
}

export function buildPlayRecordKey(source: string, id: string): string {
  const identity = normalizePlayRecordIdentity(source, id);
  if (!identity) throw new Error('Invalid PlayRecord identity');
  return identity.canonicalKey;
}

export function comparePlayRecordIdentity(
  left: unknown,
  right: unknown,
): boolean {
  const leftIdentity = resolvePlayRecordIdentity(left);
  const rightIdentity = resolvePlayRecordIdentity(right);
  return (
    leftIdentity !== null &&
    rightIdentity !== null &&
    compareContentIdentity(leftIdentity.identity, rightIdentity.identity)
  );
}
