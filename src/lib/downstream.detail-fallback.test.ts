// switch-chinese 只服务于搜索变体的繁简转换，详情解析链路完全用不到；该包是
// 纯 ESM（package.json 只导出 import 条件），Jest 的 CJS 解析器加载不到，
// 因此用 virtual mock 以透传实现替代，不影响被测逻辑。
jest.mock(
  'switch-chinese',
  () => ({
    __esModule: true,
    default: () => ({ convert: (text: string) => text }),
  }),
  { virtual: true },
);

// config.ts 会连带加载 @/lib/db（多存储后端）与 next/cache，在 jsdom 测试环境
// 下无法直接 import。这里只替换出 downstream 真正用到的 API_CONFIG，取值与
// src/lib/config.ts 中的定义逐字一致；被测试的回落逻辑本身不依赖其它配置。
jest.mock('./config', () => ({
  API_CONFIG: {
    search: {
      path: '?ac=videolist&wd=',
      pagePath: '?ac=videolist&wd={query}&pg={page}',
      headers: { Accept: 'application/json' },
    },
    detail: {
      path: '?ac=videolist&ids=',
      headers: { Accept: 'application/json' },
    },
  },
}));

import type { ApiSite } from './config';
import { getDetailFromApi } from './downstream';

/**
 * getDetailFromApi 的「HTML 详情页失败 → 回落标准 JSON 采集接口」回归测试。
 *
 * 背景：配置了 detail 字段的特殊源（HTML 详情页站点）在 HTML 页面不可用时
 * （例如被 Cloudflare 拦截返回 403），此前 getDetailFromApi 会直接把异常抛给
 * 调用方，服务端追更检测（CmsLatestEpisodeProvider）因此永远拿不到集数，表现
 * 为「前端剧集列表能看到新集，但追更永远没有提醒」。本文件锁定回落行为。
 */
const siteWithDetail: ApiSite = {
  key: 'jszyapi',
  name: '极速资源',
  api: 'https://jszyapi.com/api.php/provide/vod/',
  detail: 'https://jszyapi.com',
};

const siteWithoutDetail: ApiSite = {
  key: 'rycjapi',
  name: '如意资源',
  api: 'http://cj.rycjapi.com/api.php/provide/vod/',
};

const jsonDetailPayload = {
  list: [
    {
      vod_id: '153319',
      vod_name: '无可救药',
      vod_pic: 'https://img.example.com/a.jpg',
      vod_year: '2026',
      vod_remarks: '第5集',
      vod_play_url:
        '第1集$https://vv.example.com/play/a/index.m3u8#第2集$https://vv.example.com/play/b/index.m3u8#第3集$https://vv.example.com/play/c/index.m3u8',
    },
  ],
};

// HTML 详情页里的链接必须是「$ + 直链」形态，才能被 handleSpecialSourceDetail
// 的通用正则 /\$(https?:\/\/[^"'\s]+?\.m3u8)/g 命中，与真实资源站页面一致。
const htmlWithEpisodes = `<!doctype html><html><head><title>无可救药</title></head>
<body><h1>无可救药</h1><div class="sketch">剧情简介</div>
<script>var player=[{"name":"第1集","url":"$https://vv.example.com/play/a/index.m3u8"},{"name":"第2集","url":"$https://vv.example.com/play/b/index.m3u8"}];</script>
</body></html>`;

const htmlWithoutEpisodes = `<!doctype html><html><head><title>Just a moment...</title></head>
<body><h1>无可救药</h1></body></html>`;

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function htmlResponse(html: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(html),
    text: async () => html,
  } as unknown as Response;
}

describe('getDetailFromApi HTML 详情页回落', () => {
  const originalFetch = global.fetch;
  let requestedUrls: string[];

  beforeEach(() => {
    requestedUrls = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('HTML 详情页返回 403 时改用 JSON 采集接口并返回集数', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('/index.php/vod/detail/id/')) {
        return htmlResponse(
          '<html><title>Just a moment...</title></html>',
          403,
        );
      }
      return jsonResponse(jsonDetailPayload);
    }) as unknown as typeof fetch;

    const result = await getDetailFromApi(siteWithDetail, '153319');

    expect(requestedUrls[0]).toBe(
      'https://jszyapi.com/index.php/vod/detail/id/153319.html',
    );
    expect(requestedUrls[1]).toBe(
      'https://jszyapi.com/api.php/provide/vod/?ac=videolist&ids=153319',
    );
    expect(result.title).toBe('无可救药');
    expect(result.episodes).toHaveLength(3);
  });

  it('HTML 详情页可访问但解析不出集数时同样回落 JSON 采集接口', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('/index.php/vod/detail/id/')) {
        return htmlResponse(htmlWithoutEpisodes);
      }
      return jsonResponse(jsonDetailPayload);
    }) as unknown as typeof fetch;

    const result = await getDetailFromApi(siteWithDetail, '153319');

    expect(requestedUrls).toHaveLength(2);
    expect(result.episodes).toHaveLength(3);
  });

  it('HTML 详情页正常解析出集数时保持原有行为，不再请求 JSON 接口', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      return htmlResponse(htmlWithEpisodes);
    }) as unknown as typeof fetch;

    const result = await getDetailFromApi(siteWithDetail, '153319');

    expect(requestedUrls).toHaveLength(1);
    expect(result.episodes).toEqual([
      'https://vv.example.com/play/a/index.m3u8',
      'https://vv.example.com/play/b/index.m3u8',
    ]);
  });

  it('未配置 detail 的源继续只走 JSON 采集接口', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      return jsonResponse(jsonDetailPayload);
    }) as unknown as typeof fetch;

    const result = await getDetailFromApi(siteWithoutDetail, '153319');

    expect(requestedUrls).toEqual([
      'http://cj.rycjapi.com/api.php/provide/vod/?ac=videolist&ids=153319',
    ]);
    expect(result.episodes).toHaveLength(3);
  });
});
