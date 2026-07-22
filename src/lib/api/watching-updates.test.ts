import { WatchingUpdatesRepository } from './watching-updates';

describe('WatchingUpdatesRepository', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses only the formal watching-updates API paths', async () => {
    const repository = new WatchingUpdatesRepository();

    await repository.getCapability();
    await repository.getResults();
    await repository.check(['follow-1']);
    await repository.sync([
      {
        followId: 'follow-1',
        source: 'source-a',
        resourceId: 'video-1',
        latestEpisode: 12,
        observedAt: 1000,
        clientId: 'web',
      },
    ]);

    const fetchMock = jest.mocked(global.fetch);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/watching-updates/capability',
      '/api/watching-updates/results',
      '/api/watching-updates/check',
      '/api/watching-updates/sync',
    ]);
    const syncBody = JSON.parse(String(fetchMock.mock.calls[3][1]?.body))
      .observations[0];
    expect(syncBody).toEqual({
      followId: 'follow-1',
      source: 'source-a',
      resourceId: 'video-1',
      latestEpisode: 12,
      observedAt: 1000,
      clientId: 'web',
    });
    expect(syncBody).not.toHaveProperty('hasUpdate');
    expect(syncBody).not.toHaveProperty('unwatchedCount');
  });
});
