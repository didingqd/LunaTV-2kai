import {
  buildContentIdentityKey,
  compareContentIdentity,
  resolveContentIdentity,
  type ContentIdentity,
} from './content-identity';

export interface FavoriteReminderIdentityFields extends ContentIdentity {
  sourceKey: string;
  videoId: string;
}

export type FavoriteReminderIdentityItem<T> = T &
  FavoriteReminderIdentityFields & { key: string };

export interface FavoriteReminderIdentityMigration<T> {
  storedKey: string;
  identityKey: string;
  value: T;
  writeCanonical: boolean;
}

export function normalizeFavoriteReminderRecord<T>(values: Record<string, T>): {
  values: Record<string, T>;
  migrations: FavoriteReminderIdentityMigration<T>[];
  changed: boolean;
} {
  const normalized: Record<string, T> = {};
  const legacyEntries: Array<{
    storedKey: string;
    identity: ContentIdentity;
    value: T;
  }> = [];

  for (const [storedKey, value] of Object.entries(values)) {
    const identity = resolveStoredIdentity(storedKey, value);
    if (!identity) {
      normalized[storedKey] = value;
      continue;
    }

    const identityKey = buildContentIdentityKey(identity.source, identity.id);
    if (storedKey === identityKey) {
      normalized[identityKey] = value;
    } else {
      legacyEntries.push({ storedKey, identity, value });
    }
  }

  const migrations = legacyEntries.map(({ storedKey, identity, value }) => {
    const identityKey = buildContentIdentityKey(identity.source, identity.id);
    const writeCanonical = !Object.prototype.hasOwnProperty.call(
      normalized,
      identityKey,
    );
    if (writeCanonical) normalized[identityKey] = value;

    return { storedKey, identityKey, value, writeCanonical };
  });

  return {
    values: normalized,
    migrations,
    changed: migrations.length > 0,
  };
}

export function findFavoriteReminderIdentityEntry<T>(
  values: Record<string, T>,
  identityInput: unknown,
): { key: string; value: T; identity: ContentIdentity } | null {
  const identity = resolveContentIdentity(identityInput);
  if (!identity) return null;

  if (Object.prototype.hasOwnProperty.call(values, identity.identityKey)) {
    return {
      key: identity.identityKey,
      value: values[identity.identityKey],
      identity,
    };
  }

  for (const [key, value] of Object.entries(values)) {
    if (compareContentIdentity({ key }, identity)) {
      return { key, value, identity };
    }
  }

  return null;
}

export function hasFavoriteReminderIdentity(
  values: Record<string, unknown>,
  identityInput: unknown,
): boolean {
  return findFavoriteReminderIdentityEntry(values, identityInput) !== null;
}

export function mapFavoriteReminderIdentityItem<T extends object>(
  key: string,
  value: T,
): FavoriteReminderIdentityItem<T> | null {
  const identity = resolveStoredIdentity(key, value);
  if (!identity) return null;

  const identityKey = buildContentIdentityKey(identity.source, identity.id);
  return {
    ...value,
    key: identityKey,
    source: identity.source,
    id: identity.id,
    identityKey,
    sourceKey: identity.source,
    videoId: identity.id,
  };
}

function resolveStoredIdentity(
  key: string,
  value: unknown,
): ContentIdentity | null {
  const keyIdentity = resolveContentIdentity({ key });
  if (
    keyIdentity &&
    key === buildContentIdentityKey(keyIdentity.source, keyIdentity.id)
  ) {
    return keyIdentity;
  }

  return resolveContentIdentity(value) ?? keyIdentity;
}
