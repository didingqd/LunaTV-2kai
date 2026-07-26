import { buildContentIdentityKey } from './content-identity';
import {
  findFavoriteReminderIdentityEntry,
  findResourceFavoriteReminderKey,
  hasFavoriteReminderIdentity,
  mapFavoriteReminderIdentityItem,
  normalizeFavoriteReminderRecord,
} from './favorite-reminder-identity';

describe('Favorite/Reminder ContentIdentity adapter', () => {
  const source = 'a+b';
  const id = '123+456';
  const identityKey = buildContentIdentityKey(source, id);

  it('maps canonical records to safe identity fields and compatibility fields', () => {
    expect(
      mapFavoriteReminderIdentityItem(identityKey, {
        title: 'Demo',
        source_name: 'Source',
      }),
    ).toEqual({
      title: 'Demo',
      source_name: 'Source',
      key: identityKey,
      source,
      id,
      identityKey,
      sourceKey: source,
      videoId: id,
    });
  });

  it('finds and checks special-character identities without delimiter parsing', () => {
    const values = { [identityKey]: { title: 'Demo' } };

    expect(findFavoriteReminderIdentityEntry(values, { source, id })).toEqual({
      key: identityKey,
      value: { title: 'Demo' },
      identity: { source, id, identityKey },
    });
    expect(hasFavoriteReminderIdentity(values, { source, id })).toBe(true);
    expect(hasFavoriteReminderIdentity(values, { source, id: '123+457' })).toBe(
      false,
    );
  });

  it('normalizes legacy keys lazily', () => {
    const legacyValue = { title: 'Legacy' };
    const normalized = normalizeFavoriteReminderRecord({
      'bangumi+123+456': legacyValue,
    });
    const canonicalKey = buildContentIdentityKey('bangumi', '123+456');

    expect(normalized.values).toEqual({ [canonicalKey]: legacyValue });
    expect(normalized.migrations).toEqual([
      {
        storedKey: 'bangumi+123+456',
        identityKey: canonicalKey,
        value: legacyValue,
        writeCanonical: true,
      },
    ]);
  });

  it('keeps canonical data when a matching legacy key also exists', () => {
    const canonicalKey = buildContentIdentityKey('bangumi', '123');
    const canonicalValue = { title: 'Canonical' };
    const normalized = normalizeFavoriteReminderRecord({
      'bangumi+123': { title: 'Legacy' },
      [canonicalKey]: canonicalValue,
    });

    expect(normalized.values).toEqual({ [canonicalKey]: canonicalValue });
    expect(normalized.migrations[0]).toMatchObject({
      storedKey: 'bangumi+123',
      identityKey: canonicalKey,
      writeCanonical: false,
    });
  });

  it('preserves unparseable records instead of guessing or dropping them', () => {
    const value = { title: 'Unknown' };
    const normalized = normalizeFavoriteReminderRecord({ unknown: value });

    expect(normalized.values).toEqual({ unknown: value });
    expect(normalized.migrations).toEqual([]);
    expect(normalized.changed).toBe(false);
  });

  it('matches resource favorites only by source and id, not by same title metadata', () => {
    const sourceAKey = buildContentIdentityKey('source-a', '001');
    const sourceBKey = buildContentIdentityKey('source-b', '002');
    const favorites = {
      [sourceAKey]: { title: '鬼灭', source: 'source-a', id: '001' },
    };

    // Stage 7.7: this guards the play page favorite matcher from falling back
    // to title/douban/bangumi metadata. Favoriting A must not mark B as
    // favorited, and deleting B must not discover A's storage key.
    expect(
      findResourceFavoriteReminderKey(favorites, {
        source: 'source-a',
        id: '001',
      }),
    ).toBe(sourceAKey);
    expect(
      findResourceFavoriteReminderKey(favorites, {
        source: 'source-b',
        id: '002',
        title: '鬼灭',
        doubanId: 123,
      }),
    ).toBeNull();
    expect(favorites[sourceAKey]).toBeDefined();
    expect(favorites[sourceBKey]).toBeUndefined();
  });
});
