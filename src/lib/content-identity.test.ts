import {
  buildContentIdentityKey,
  compareContentIdentity,
  normalizeContentIdentity,
  resolveContentIdentity,
} from './content-identity';

describe('ContentIdentity resolver', () => {
  it('builds the existing canonical source/id key', () => {
    expect(buildContentIdentityKey('bangumi', '123')).toBe(
      encodeURIComponent(JSON.stringify(['bangumi', '123'])),
    );
    expect(resolveContentIdentity({ source: 'bangumi', id: '123' })).toEqual({
      source: 'bangumi',
      id: '123',
      identityKey: buildContentIdentityKey('bangumi', '123'),
    });
  });

  it.each([
    ['abc+def', '123'],
    ['bangumi', '123+456'],
    ['abc__def', '123'],
    ['bangumi', '123__456'],
    ['中文源', '剧集一'],
    ['source name', 'episode 1'],
  ])('preserves special characters in source=%s id=%s', (source, id) => {
    const identity = resolveContentIdentity({ source, id });

    expect(identity).toEqual({
      source,
      id,
      identityKey: buildContentIdentityKey(source, id),
    });
    expect(resolveContentIdentity(identity?.identityKey)).toEqual(identity);
  });

  it('resolves legacy sourceKey/videoId fields to the same identity', () => {
    const current = resolveContentIdentity({
      source: 'abc+def',
      id: '123+456',
    });
    const legacy = resolveContentIdentity({
      sourceKey: 'abc+def',
      videoId: '123+456',
    });

    expect(legacy).toEqual(current);
    expect(compareContentIdentity(current, legacy)).toBe(true);
  });

  it('resolves PlayRecord canonical and legacy keys', () => {
    const canonicalKey = buildContentIdentityKey('bangumi', '123+456');

    expect(resolveContentIdentity({ key: canonicalKey })).toEqual({
      source: 'bangumi',
      id: '123+456',
      identityKey: canonicalKey,
    });
    expect(resolveContentIdentity({ key: 'bangumi+123+456' })).toEqual({
      source: 'bangumi',
      id: '123+456',
      identityKey: canonicalKey,
    });
  });

  it('supports WatchingFollow and result DTO inputs', () => {
    const identityKey = buildContentIdentityKey('source-a', 'video-1');

    expect(
      resolveContentIdentity({ source: 'source-a', id: 'video-1' }),
    ).toEqual({ source: 'source-a', id: 'video-1', identityKey });
    expect(
      resolveContentIdentity({
        sourceKey: 'legacy-source',
        videoId: 'legacy-id',
        identityKey,
      }),
    ).toEqual({ source: 'source-a', id: 'video-1', identityKey });
  });

  it('normalizes direct source/id arguments without generating legacy fields', () => {
    expect(normalizeContentIdentity('source a', 'id/一')).toEqual({
      source: 'source a',
      id: 'id/一',
      identityKey: buildContentIdentityKey('source a', 'id/一'),
    });
  });

  it('rejects incomplete and ambiguous delimiter-only input', () => {
    expect(resolveContentIdentity({ source: 'bangumi' })).toBeNull();
    expect(resolveContentIdentity({ sourceKey: 'bangumi' })).toBeNull();
    expect(resolveContentIdentity({ key: 'source__id' })).toBeNull();
    expect(compareContentIdentity({ source: '', id: '1' }, {})).toBe(false);
  });
});
