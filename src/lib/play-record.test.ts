import {
  legacyPlayRecordStorageKey,
  normalizePlayRecordKeys,
  parsePlayRecordStorageKey,
  playbackFactsOnly,
  playRecordStorageKey,
} from './play-record';
import { calculateWatchingUpdate } from './watching-update-calculation';
import type { PlayRecord } from './types';

const record: PlayRecord = {
  title: 'Demo',
  source_name: 'Bangumi',
  cover: '',
  year: '2026',
  index: 1,
  total_episodes: 3,
  play_time: 10,
  total_time: 100,
  save_time: 1,
  search_title: 'Demo',
};

describe('PlayRecord identity protocol', () => {
  it('round-trips canonical source and id values containing special characters', () => {
    const key = playRecordStorageKey('bangumi+archive', '123+456 / 中文');
    expect(parsePlayRecordStorageKey(key)).toEqual({
      source: 'bangumi+archive',
      id: '123+456 / 中文',
      isLegacy: false,
    });
  });

  it('falls back to the legacy source+id key parser', () => {
    const safeKey = playRecordStorageKey('bangumi', '123+456');
    const legacyKey = legacyPlayRecordStorageKey('bangumi', '123+456');
    const migrated = normalizePlayRecordKeys({
      [legacyKey]: record,
    });
    expect(migrated.changed).toBe(true);
    expect(migrated.records[safeKey]).toBe(record);
  });

  it('keeps the canonical entry when matching legacy and canonical keys coexist', () => {
    const safeKey = playRecordStorageKey('bangumi', '123+456');
    const legacyKey = legacyPlayRecordStorageKey('bangumi', '123+456');
    const canonicalRecord = { ...record, title: 'Canonical' };
    const legacyRecord = { ...record, title: 'Legacy' };

    const migrated = normalizePlayRecordKeys({
      [legacyKey]: legacyRecord,
      [safeKey]: canonicalRecord,
    });

    expect(migrated.changed).toBe(true);
    expect(migrated.records).toEqual({ [safeKey]: canonicalRecord });
  });

  it('does not let playback writes modify original_episodes', () => {
    const facts = playbackFactsOnly({
      ...record,
      original_episodes: 10,
    });
    expect(facts).not.toHaveProperty('original_episodes');
  });

  it('uses WatchingFollow originalEpisodes as the baseline input', () => {
    expect(
      calculateWatchingUpdate({
        originalEpisodes: 10,
        detailEpisodes: 15,
        recordTotalEpisodes: 15,
        watchedEpisodes: 12,
      }).newEpisodes,
    ).toBe(3);
  });
});
