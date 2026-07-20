import { buildContentIdentityKey } from './content-identity';
import {
  buildPlayRecordKey,
  comparePlayRecordIdentity,
  normalizePlayRecordIdentity,
  parseLegacyPlayRecordKey,
  resolvePlayRecordIdentity,
} from './play-record-identity';

describe('PlayRecord Identity Adapter', () => {
  it.each([
    ['a', '123'],
    ['a+b', '123'],
    ['a', 'b+123'],
    ['测试源', '第 1 集'],
    [' a ', ' 123 '],
  ])('builds canonical identity for explicit fields', (source, id) => {
    expect(buildPlayRecordKey(source, id)).toBe(
      buildContentIdentityKey(source, id),
    );
    expect(normalizePlayRecordIdentity(source, id)).toMatchObject({
      source,
      id,
      canonicalKey: buildContentIdentityKey(source, id),
      format: 'fields',
    });
  });

  it('parses a legacy key only when one separator exists', () => {
    expect(parseLegacyPlayRecordKey('abc+123')).toMatchObject({
      migratable: true,
      identity: {
        source: 'abc',
        id: '123',
        canonicalKey: buildContentIdentityKey('abc', '123'),
      },
    });
  });

  it.each(['a+b+123', '+123', 'abc+'])(
    'rejects unsafe legacy key %s',
    (key) => {
      const result = parseLegacyPlayRecordKey(key);
      expect(result.migratable).toBe(false);
      expect(result.identity).toBeNull();
    },
  );

  it('reports multiple separators as ambiguous', () => {
    expect(parseLegacyPlayRecordKey('a+b+123')).toEqual({
      identity: null,
      legacyKey: 'a+b+123',
      migratable: false,
      reason: 'ambiguous',
    });
  });

  it('resolves canonical keys before legacy parsing', () => {
    const key = buildContentIdentityKey('a+b', '123+456');
    expect(resolvePlayRecordIdentity(key)).toMatchObject({
      source: 'a+b',
      id: '123+456',
      canonicalKey: key,
      format: 'canonical',
    });
  });

  it('compares only safely resolved identities', () => {
    expect(
      comparePlayRecordIdentity('abc+123', { source: 'abc', id: '123' }),
    ).toBe(true);
    expect(
      comparePlayRecordIdentity('a+b+123', { source: 'a', id: 'b+123' }),
    ).toBe(false);
    expect(
      comparePlayRecordIdentity(
        { source: 'a+b', id: '123' },
        {
          source: 'a',
          id: 'b+123',
        },
      ),
    ).toBe(false);
  });
});
