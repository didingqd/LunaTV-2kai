import {
  readWatchingUpdateSourceMode,
  WATCHING_UPDATE_SOURCE_MODE_KEY,
  writeWatchingUpdateSourceMode,
} from './watching-update-preference';

describe('Watching Update source preference', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to local and persists an explicit backend choice', () => {
    expect(readWatchingUpdateSourceMode()).toBe('local');

    writeWatchingUpdateSourceMode('backend');

    expect(readWatchingUpdateSourceMode()).toBe('backend');
    expect(window.localStorage.getItem(WATCHING_UPDATE_SOURCE_MODE_KEY)).toBe(
      'backend',
    );
  });

  it('treats unknown stored values as local', () => {
    window.localStorage.setItem(WATCHING_UPDATE_SOURCE_MODE_KEY, 'unknown');
    expect(readWatchingUpdateSourceMode()).toBe('local');
  });
});
