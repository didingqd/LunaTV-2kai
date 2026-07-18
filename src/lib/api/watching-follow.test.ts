import {
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
      originalEpisodes: 10,
      enabled: true,
    });
    await postWatchingFollow({
      source: 'other',
      id: 'same-id',
      title: 'Other Demo',
      cover: '',
      year: '2026',
      originalEpisodes: 12,
      enabled: true,
    });

    const follows = await getWatchingFollows();
    expect(isWatchingFollowActive(follows, 'main', 'same-id')).toBe(true);
    expect(isWatchingFollowActive(follows, 'other', 'same-id')).toBe(true);
    expect(isWatchingFollowActive(follows, 'main', 'missing')).toBe(false);
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
      originalEpisodes: 20,
      enabled: true,
    });
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
