import { buildContentIdentityKey } from './content-identity';

jest.mock('@/lib/db', () => ({
  db: {
    getCache: jest.fn(),
    setCache: jest.fn(),
  },
}));

import {
  deleteRemarkEntries,
  resolveRemarkEntry,
  resolveRemarkWriteKey,
  type RemarkRecord,
  type RemarksMap,
} from './video-remarks.server';

const legacyRecord: RemarkRecord = {
  remark: 'legacy',
  updatedAt: 1,
  origin: 'manual',
};
const canonicalRecord: RemarkRecord = {
  remark: 'canonical',
  updatedAt: 2,
  origin: 'manual',
};

describe('Video Remarks server identity', () => {
  it('uses the ContentIdentity canonical key for ordinary writes', () => {
    expect(resolveRemarkWriteKey('a+b', '123+456')).toBe(
      buildContentIdentityKey('a+b', '123+456'),
    );
  });

  it('falls back to safe legacy data and lazily adds canonical data', () => {
    const remarks: RemarksMap = { abc__123: legacyRecord };
    const canonicalKey = buildContentIdentityKey('abc', '123');

    const lookup = resolveRemarkEntry(remarks, 'abc', '123');

    expect(lookup).toMatchObject({
      key: canonicalKey,
      record: legacyRecord,
      migrated: true,
    });
    expect(remarks[canonicalKey]).toBe(legacyRecord);
    expect(remarks.abc__123).toBe(legacyRecord);
  });

  it('prefers canonical data when canonical and legacy both exist', () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    const remarks: RemarksMap = {
      [canonicalKey]: canonicalRecord,
      abc__123: legacyRecord,
    };

    const lookup = resolveRemarkEntry(remarks, 'abc', '123');

    expect(lookup?.record).toBe(canonicalRecord);
    expect(lookup?.migrated).toBe(false);
    expect(remarks.abc__123).toBe(legacyRecord);
  });

  it('does not migrate an ambiguous legacy key', () => {
    const remarks: RemarksMap = { a____123: legacyRecord };

    const lookup = resolveRemarkEntry(remarks, 'a__', '123');

    expect(lookup?.record).toBeUndefined();
    expect(lookup?.migrated).toBe(false);
    expect(remarks.a____123).toBe(legacyRecord);
    expect(remarks[buildContentIdentityKey('a__', '123')]).toBeUndefined();
  });

  it('deletes canonical and safe legacy entries without deleting ambiguous data', () => {
    const canonicalKey = buildContentIdentityKey('abc', '123');
    const remarks: RemarksMap = {
      [canonicalKey]: canonicalRecord,
      abc__123: legacyRecord,
      a____123: legacyRecord,
    };

    expect(deleteRemarkEntries(remarks, 'abc', '123')).toBe(true);
    expect(remarks[canonicalKey]).toBeUndefined();
    expect(remarks.abc__123).toBeUndefined();

    expect(deleteRemarkEntries(remarks, 'a__', '123')).toBe(false);
    expect(remarks.a____123).toBe(legacyRecord);
  });

  it('keeps Bangumi on its semantic identity protocol', () => {
    const remarks: RemarksMap = { bangumi__123: legacyRecord };

    expect(resolveRemarkWriteKey('bangumi', '123')).toBe('bangumi__123');
    expect(resolveRemarkEntry(remarks, 'bangumi', '123')).toMatchObject({
      key: 'bangumi__123',
      record: legacyRecord,
      migrated: false,
    });
    expect(remarks[buildContentIdentityKey('bangumi', '123')]).toBeUndefined();
  });
});
