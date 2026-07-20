import { buildContentIdentityKey } from './content-identity';
import {
  buildSkipConfigKey,
  compareSkipConfigIdentity,
  contentStorageIdentity,
  legacySkipConfigKey,
  normalizeSkipConfigIdentity,
  normalizeSkipConfigRecord,
  resolveLegacySkipConfigKey,
  resolveSkipConfigIdentityKey,
} from './skip-config-identity';

describe('SkipConfig identity adapter', () => {
  it.each([
    ['a+b', '123'],
    ['source', '123+456'],
    ['a+b', '123+456'],
  ])('builds a canonical key for source=%s id=%s', (source, id) => {
    const key = buildSkipConfigKey(source, id);

    expect(key).toBe(buildContentIdentityKey(source, id));
    expect(resolveSkipConfigIdentityKey(key)).toMatchObject({
      kind: 'content',
      source,
      id,
      storageKey: key,
    });
  });

  it('normalizes explicit source/id without guessing delimiters', () => {
    const identity = normalizeSkipConfigIdentity('a+b', '123+456');

    expect(identity).toMatchObject({
      kind: 'content',
      source: 'a+b',
      id: '123+456',
      storageKey: buildContentIdentityKey('a+b', '123+456'),
    });
    expect(identity?.legacyKey).toBeUndefined();
  });

  it('accepts only unambiguous legacy content keys', () => {
    expect(resolveLegacySkipConfigKey('bangumi+123')).toMatchObject({
      kind: 'content',
      source: 'bangumi',
      id: '123',
      legacyKey: 'bangumi+123',
    });
    expect(resolveLegacySkipConfigKey('a+b+123')).toBeNull();
    expect(resolveLegacySkipConfigKey('source+123+456')).toBeNull();
  });

  it('keeps semantic identities outside ContentIdentity', () => {
    expect(normalizeSkipConfigIdentity({}, undefined, 'douban:123')).toEqual({
      kind: 'semantic',
      source: 'douban:123',
      id: '__identity__',
      storageKey: 'douban:123+__identity__',
      semanticKey: 'douban:123',
    });
    expect(
      resolveLegacySkipConfigKey('title:C++ Primer:2026+__identity__'),
    ).toEqual({
      kind: 'semantic',
      source: 'title:C++ Primer:2026',
      id: '__identity__',
      storageKey: 'title:C++ Primer:2026+__identity__',
      semanticKey: 'title:C++ Primer:2026',
    });
  });

  it('compares canonical and unambiguous legacy content identities', () => {
    expect(
      compareSkipConfigIdentity(
        buildContentIdentityKey('bangumi', '123'),
        'bangumi+123',
      ),
    ).toBe(true);
    expect(
      compareSkipConfigIdentity(
        { source: 'a+b', id: '123+456' },
        { source: 'a+b', id: '123+457' },
      ),
    ).toBe(false);
  });

  it('provides canonical and safe legacy physical identities', () => {
    expect(contentStorageIdentity('bangumi', '123')).toEqual({
      source: buildContentIdentityKey('bangumi', '123'),
      id: '',
    });
    expect(legacySkipConfigKey('bangumi', '123')).toBe('bangumi+123');
    expect(legacySkipConfigKey('a+b', '123')).toBeNull();
  });

  it('prefers canonical records and describes lazy legacy migration', () => {
    const canonicalKey = buildSkipConfigKey('bangumi', '123');
    const canonical = { enable: true };
    const normalized = normalizeSkipConfigRecord({
      'bangumi+123': { enable: false },
      [canonicalKey]: canonical,
    });

    expect(normalized.values).toEqual({ [canonicalKey]: canonical });
    expect(normalized.migrations).toEqual([
      {
        storedKey: 'bangumi+123',
        storageKey: canonicalKey,
        value: { enable: false },
        writeCanonical: false,
      },
    ]);
  });

  it('migrates only unambiguous legacy records and preserves unknown data', () => {
    const normalized = normalizeSkipConfigRecord({
      'bangumi+123': { enable: true },
      'a+b+123': { enable: false },
    });

    expect(normalized.values).toEqual({
      [buildSkipConfigKey('bangumi', '123')]: { enable: true },
      'a+b+123': { enable: false },
    });
    expect(normalized.migrations).toHaveLength(1);
  });
});
