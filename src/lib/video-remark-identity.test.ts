import {
  buildVideoRemarkKey,
  compareVideoRemarkIdentity,
  normalizeVideoRemarkIdentity,
  resolveVideoRemarkIdentity,
} from './video-remark-identity';

describe('Video Remark Identity adapter', () => {
  it.each([
    ['a', '123'],
    ['a+b', '123+456'],
    ['测试源', '第1集'],
    [' a ', ' 123 '],
  ])('builds canonical identity for source=%s id=%s', (source, id) => {
    const result = normalizeVideoRemarkIdentity(source, id);

    expect(result).not.toBeNull();
    expect(result?.canonicalKey).toBe(buildVideoRemarkKey(source, id));
    expect(result?.identity.source).toBe(source);
    expect(result?.identity.id).toBe(id);
    expect(result?.format).toBe('fields');
  });

  it('resolves an unambiguous legacy key', () => {
    const result = resolveVideoRemarkIdentity('abc__123');

    expect(result).toMatchObject({
      format: 'legacy',
      migratable: true,
      legacyKey: 'abc__123',
      identity: {
        source: 'abc',
        id: '123',
      },
    });
  });

  it.each(['a____123', 'a__b__123', '__123', 'abc__', 'bangumi__123'])(
    'rejects unsafe legacy key %s',
    (key) => {
      expect(resolveVideoRemarkIdentity(key)).toBeNull();
    },
  );

  it('resolves canonical and explicit source/id to the same identity', () => {
    const explicit = normalizeVideoRemarkIdentity('a+b', '123+456');
    const canonical = resolveVideoRemarkIdentity(explicit?.canonicalKey);

    expect(canonical?.identity).toEqual(explicit?.identity);
    expect(canonical?.canonicalKey).toBe(explicit?.canonicalKey);
    expect(compareVideoRemarkIdentity(explicit, canonical)).toBe(true);
  });

  it('keeps generated legacy keys non-migratable when boundaries are unsafe', () => {
    const result = normalizeVideoRemarkIdentity('a__', '123');

    expect(result?.canonicalKey).toBe(buildVideoRemarkKey('a__', '123'));
    expect(result?.legacyKey).toBe('a____123');
    expect(result?.migratable).toBe(false);
  });

  it('compares equal and different identities correctly', () => {
    expect(
      compareVideoRemarkIdentity(
        normalizeVideoRemarkIdentity('source', '123'),
        'source__123',
      ),
    ).toBe(true);
    expect(
      compareVideoRemarkIdentity(
        normalizeVideoRemarkIdentity('source', '123'),
        normalizeVideoRemarkIdentity('other', '123'),
      ),
    ).toBe(false);
    expect(compareVideoRemarkIdentity('a____123', 'a__123')).toBe(false);
  });
});
