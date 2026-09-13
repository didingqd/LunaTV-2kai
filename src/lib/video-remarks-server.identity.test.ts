import { buildContentIdentityKey } from './content-identity';

jest.mock('@/lib/db', () => ({
  db: {
    getCache: jest.fn(),
    setCache: jest.fn(),
  },
}));

import {
  deleteRemarkEntries,
  isTombstone,
  manualRemarksOnly,
  normalizeRecord,
  pruneExpiredTombstones,
  type RemarkRecord,
  type RemarksMap,
  resolveRemarkEntry,
  resolveRemarkWriteKey,
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

// 【墓碑重设计·新增】墓碑判据 / 归一化升格 / GC / 导出过滤的单元契约。
describe('Video Remarks tombstones', () => {
  const now = Date.now();

  it('treats records with deletedAt as tombstones and normalizes them', () => {
    expect(isTombstone(legacyRecord)).toBe(false);

    const tombstone = normalizeRecord({
      remark: 'ignored content',
      updatedAt: 10,
      origin: 'manual',
      deletedAt: 12,
    });
    // 显式墓碑：remark 强制为空、origin 归一 manual，防止脏数据借墓碑壳
    // 带内容复活。
    expect(tombstone).toEqual({
      remark: '',
      updatedAt: 10,
      origin: 'manual',
      deletedAt: 12,
    });
    expect(isTombstone(tombstone!)).toBe(true);
  });

  it('upgrades legacy implicit tombstones (empty manual remark) to deletedAt', () => {
    const upgraded = normalizeRecord({
      remark: '',
      updatedAt: 55,
      origin: 'manual',
    });
    expect(upgraded).toEqual({
      remark: '',
      updatedAt: 55,
      origin: 'manual',
      deletedAt: 55,
    });

    // 空的非 manual 记录仍是异常数据，直接丢弃。
    expect(
      normalizeRecord({ remark: '', updatedAt: 55, origin: 'bangumi_date' }),
    ).toBeNull();
  });

  it('prunes expired tombstones and keeps fresh ones', () => {
    const remarks: RemarksMap = {
      expired: {
        remark: '',
        updatedAt: 1,
        origin: 'manual',
        deletedAt: now - 31 * 24 * 60 * 60 * 1000,
      },
      fresh: {
        remark: '',
        updatedAt: 2,
        origin: 'manual',
        deletedAt: now - 1000,
      },
      live: canonicalRecord,
    };

    expect(pruneExpiredTombstones(remarks, now)).toBe(true);
    expect(remarks.expired).toBeUndefined();
    expect(remarks.fresh).toBeDefined();
    expect(remarks.live).toBeDefined();

    // 无过期墓碑时返回 false（无变更）。
    expect(pruneExpiredTombstones(remarks, now)).toBe(false);
  });

  it('excludes tombstones from manualRemarksOnly exports and pushes', () => {
    const remarks: RemarksMap = {
      live: legacyRecord,
      tombstone: {
        remark: '',
        updatedAt: 3,
        origin: 'manual',
        deletedAt: 3,
      },
    };

    expect(Object.keys(manualRemarksOnly(remarks))).toEqual(['live']);
  });
});
