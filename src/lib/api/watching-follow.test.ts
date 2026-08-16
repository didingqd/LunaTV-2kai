import {
  advanceWatchingFollowOriginalEpisodes,
  deleteWatchingFollow,
  getWatchingFollows,
  isLocalWatchingFollowMode,
  isWatchingFollowActive,
  parseWatchingFollowRecord,
  postWatchingFollow,
  watchingFollowKey,
} from './watching-follow';

describe('WatchingFollow client service', () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn();
    (
      window as Window & { RUNTIME_CONFIG?: { STORAGE_TYPE: string } }
    ).RUNTIME_CONFIG = { STORAGE_TYPE: 'localstorage' };
    jest.restoreAllMocks();
  });

  it('creates and deletes a local follow without touching play records', async () => {
    window.localStorage.setItem(
      'moontv_play_records',
      JSON.stringify({ 'main+demo': { index: 3 } }),
    );
    window.localStorage.setItem(
      'moontv_favorites',
      JSON.stringify({ 'main+demo': { title: 'Favorite Demo' } }),
    );

    const follow = await postWatchingFollow({
      source: 'main',
      id: 'demo',
      title: 'Demo',
      cover: 'cover.jpg',
      year: '2026',
      type: 'tv',
      originalEpisodes: 18,
      enabled: true,
    });

    expect(follow.originalEpisodes).toBe(18);
    expect(await getWatchingFollows()).toEqual({
      [watchingFollowKey('main', 'demo')]: follow,
    });
    expect(
      isWatchingFollowActive(await getWatchingFollows(), 'main', 'demo'),
    ).toBe(true);
    expect(window.localStorage.getItem('moontv_play_records')).toContain(
      '"index":3',
    );
    expect(window.localStorage.getItem('moontv_favorites')).toContain(
      '"Favorite Demo"',
    );

    await deleteWatchingFollow('main', 'demo');

    expect(await getWatchingFollows()).toEqual({});
    expect(window.localStorage.getItem('moontv_play_records')).toContain(
      '"index":3',
    );
    expect(window.localStorage.getItem('moontv_favorites')).toContain(
      '"Favorite Demo"',
    );
  });

  it('matches follows by both source and id', async () => {
    await postWatchingFollow({
      source: 'main',
      id: 'same-id',
      title: 'Main Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 10,
      enabled: true,
    });
    await postWatchingFollow({
      source: 'other',
      id: 'same-id',
      title: 'Other Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 12,
      enabled: true,
    });

    const follows = await getWatchingFollows();
    expect(isWatchingFollowActive(follows, 'main', 'same-id')).toBe(true);
    expect(isWatchingFollowActive(follows, 'other', 'same-id')).toBe(true);
    expect(isWatchingFollowActive(follows, 'main', 'missing')).toBe(false);
  });

  it('advances local originalEpisodes monotonically without changing other state', async () => {
    const created = await postWatchingFollow({
      source: 'main',
      id: 'demo',
      title: 'Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 8,
      enabled: true,
    });

    const advanced = await advanceWatchingFollowOriginalEpisodes(
      'main',
      'demo',
      9,
    );
    const stale = await advanceWatchingFollowOriginalEpisodes(
      'main',
      'demo',
      6,
    );

    expect(created.originalEpisodes).toBe(8);
    expect(advanced.originalEpisodes).toBe(9);
    expect(stale.originalEpisodes).toBe(9);
    expect(stale.title).toBe('Demo');
  });

  it('uses the backend API outside local mode', async () => {
    (
      window as Window & { RUNTIME_CONFIG?: { STORAGE_TYPE: string } }
    ).RUNTIME_CONFIG = { STORAGE_TYPE: 'redis' };
    expect(isLocalWatchingFollowMode()).toBe(false);
    const created = {
      source: 'main',
      id: 'demo',
      title: 'Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 20,
      createdAt: 100,
      updatedAt: 100,
      enabled: true,
    };
    const fetchMock = (global.fetch as jest.MockedFunction<typeof fetch>)
      .mockResolvedValueOnce(mockResponse(created, 201))
      .mockResolvedValueOnce(mockResponse({ success: true }, 200));

    await postWatchingFollow({
      source: 'main',
      id: 'demo',
      title: 'Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 20,
      enabled: true,
    });
    await deleteWatchingFollow('main', 'demo');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/watching-follows',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/watching-follows/main/demo',
      { method: 'DELETE' },
    );
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string),
    ).toMatchObject({
      type: 'tv',
      originalEpisodes: 20,
      enabled: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).not.toEqual(
      expect.objectContaining({
        createdAt: expect.anything(),
        updatedAt: expect.anything(),
      }),
    );
  });

  it('uses the dedicated backend endpoint to advance originalEpisodes', async () => {
    (
      window as Window & { RUNTIME_CONFIG?: { STORAGE_TYPE: string } }
    ).RUNTIME_CONFIG = { STORAGE_TYPE: 'redis' };
    const advanced = {
      source: 'main',
      id: 'demo',
      title: 'Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 9,
      createdAt: 100,
      updatedAt: 200,
      enabled: true,
    };
    const fetchMock = (
      global.fetch as jest.MockedFunction<typeof fetch>
    ).mockResolvedValueOnce(mockResponse(advanced, 200));

    await expect(
      advanceWatchingFollowOriginalEpisodes('main', 'demo', 9),
    ).resolves.toEqual(advanced);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/watching-follows/main/demo/original-episodes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ originalEpisodes: 9 }),
      }),
    );
  });

  it('uses an encoded local key for source and id with plus signs', async () => {
    const follow = await postWatchingFollow({
      source: 'main+alt',
      id: 'video+1',
      title: 'Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 1,
      enabled: true,
    });

    expect(await getWatchingFollows()).toEqual({
      [watchingFollowKey('main+alt', 'video+1')]: follow,
    });
    expect(Object.keys(await getWatchingFollows())).not.toContain(
      'main+alt+video+1',
    );
  });

  it('gets and parses the backend follow list', async () => {
    (
      window as Window & { RUNTIME_CONFIG?: { STORAGE_TYPE: string } }
    ).RUNTIME_CONFIG = { STORAGE_TYPE: 'redis' };
    const follow = {
      source: 'main',
      id: 'demo',
      title: 'Demo',
      cover: '',
      year: '2026',
      type: 'tv',
      originalEpisodes: 20,
      createdAt: 100,
      updatedAt: 100,
      enabled: true,
    };
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce(
      mockResponse({ [watchingFollowKey('main', 'demo')]: follow }, 200),
    );

    await expect(getWatchingFollows()).resolves.toEqual({
      [watchingFollowKey('main', 'demo')]: follow,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/watching-follows',
      undefined,
    );
  });

  it('rejects a response key that does not match source and id', () => {
    expect(() =>
      parseWatchingFollowRecord({
        'other+demo': {
          source: 'main',
          id: 'demo',
          title: 'Demo',
          cover: '',
          year: '2026',
          type: 'tv',
          originalEpisodes: 1,
          createdAt: 1,
          updatedAt: 1,
          enabled: true,
        },
      }),
    ).toThrow('response key');
  });
});

function mockResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
