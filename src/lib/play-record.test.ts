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
  it('round-trips ids containing plus signs', () => {
    const key = playRecordStorageKey('bangumi', '123+456');
    expect(parsePlayRecordStorageKey(key)).toEqual({
      source: 'bangumi',
      id: '123+456',
      isLegacy: false,
    });
  });

  it('normalizes legacy keys and preserves an existing safe value', () => {
    const safeKey = playRecordStorageKey('bangumi', '123+456');
    const legacyKey = legacyPlayRecordStorageKey('bangumi', '123+456');
    const migrated = normalizePlayRecordKeys({
      [legacyKey]: record,
    });
    expect(migrated.changed).toBe(true);
    expect(migrated.records[safeKey]).toBe(record);
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
