/** @jest-environment node */

import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import { join } from 'path';

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(async () => ({
    DanmuApiConfig: {
      enabled: true,
      useCustomApi: true,
      customApiUrl: 'https://danmu.example',
      customToken: 'token',
      timeout: 30,
    },
  })),
}));

jest.mock('@/lib/performance-monitor', () => ({
  getDbQueryCount: jest.fn(() => 0),
  recordRequest: jest.fn(),
  resetDbQueryCount: jest.fn(),
}));

jest.mock('@/lib/douban-anti-crawler', () => ({
  fetchDoubanWithVerification: jest.fn(),
}));

import { GET } from './route';

const makeComment = (time: number, text = `t${time}`) => ({
  p: `${time},1,16777215`,
  m: text,
});

function mockDanmuApi(comments: Array<{ p: string; m: string }>) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      count: comments.length,
      comments,
    }),
  });
}

function mockAutoMatchDanmuApi() {
  (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/api/v2/search/anime')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          animes: [{ animeId: 11, animeTitle: 'Demo 2026' }],
        }),
      };
    }

    if (url.includes('/api/v2/bangumi/11')) {
      return {
        ok: true,
        json: async () => ({
          bangumi: {
            episodes: [
              { episodeId: 201, episodeTitle: 'Episode 1' },
              { episodeId: 202, episodeTitle: 'Episode 2' },
            ],
          },
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        count: 10,
        comments: Array.from({ length: 10 }, (_, index) =>
          makeComment(index + 1),
        ),
      }),
    };
  });
}

async function request(query: string) {
  return GET(new NextRequest(`http://localhost/api/danmu-external?${query}`));
}

describe('/api/danmu-external segment query', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('keeps the legacy episode_id request structure and does not apply limit without a time range', async () => {
    mockDanmuApi([
      makeComment(10),
      makeComment(100),
      makeComment(299.999),
      makeComment(300),
      makeComment(450),
      makeComment(600),
    ]);

    const response = await request('episode_id=101&limit=2');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      platforms: [{ platform: 'manual_match', count: 6 }],
      total: 6,
    });
    expect(body.danmu.map((item: { time: number }) => item.time)).toEqual([
      10, 100, 299.999, 300, 450, 600,
    ]);
  });

  it('returns start_time <= time < end_time for a segment', async () => {
    mockDanmuApi([
      makeComment(299.999),
      makeComment(300),
      makeComment(450),
      makeComment(600),
    ]);

    const response = await request(
      'episode_id=102&start_time=300&end_time=600',
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.danmu.map((item: { time: number }) => item.time)).toEqual([
      300, 450,
    ]);
  });

  it('applies limit only within the requested segment', async () => {
    mockDanmuApi([
      makeComment(10),
      makeComment(20),
      makeComment(30),
      makeComment(310),
      makeComment(320),
    ]);

    const firstSegment = await (
      await request('episode_id=103&start_time=0&end_time=300&limit=2')
    ).json();
    const secondSegment = await (
      await request('episode_id=103&start_time=300&end_time=600&limit=2')
    ).json();

    expect(firstSegment.total).toBe(2);
    expect(
      firstSegment.danmu.map((item: { time: number }) => item.time),
    ).toEqual([10, 20]);
    expect(secondSegment.total).toBe(2);
    expect(
      secondSegment.danmu.map((item: { time: number }) => item.time),
    ).toEqual([310, 320]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the matched episode_id while preserving legacy response fields', async () => {
    mockAutoMatchDanmuApi();

    const response = await request('title=Demo&year=2026&episode=2');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      episode_id: '202',
      platforms: [{ platform: 'danmu_api', count: 10 }],
      total: 10,
    });
    expect(body.danmu).toHaveLength(10);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://danmu.example/token/api/v2/comment/202?format=json',
      expect.any(Object),
    );
  });

  it('treats limit=0 as unlimited for the current segment', async () => {
    mockDanmuApi([makeComment(1), makeComment(2), makeComment(3)]);

    const response = await request(
      'episode_id=104&start_time=0&end_time=10&limit=0',
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(3);
  });

  it('returns an empty array for a segment without danmu', async () => {
    mockDanmuApi([makeComment(1), makeComment(2)]);

    const response = await request(
      'episode_id=105&start_time=300&end_time=600&limit=5000',
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.danmu).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('keeps MAX_SAFE_DANMU_ITEMS as an upstream safety guard', async () => {
    mockDanmuApi(
      Array.from({ length: 200001 }, (_, index) => makeComment(index)),
    );

    const response = await request(
      'episode_id=106&start_time=0&end_time=300&limit=0',
    );
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error).toContain('弹幕数量异常');
  });

  it('does not reintroduce the old fixed segment or sampling limits', () => {
    const routeSource = readFileSync(join(__dirname, 'route.ts'), 'utf8');

    expect(routeSource).not.toContain('MAX_DANMU_PER_SEGMENT');
    expect(routeSource).not.toContain('timeSegments');
    expect(routeSource).not.toContain('maxAllowedDanmu');
  });
});
