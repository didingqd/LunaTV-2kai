import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getCacheTime, getConfig } from '@/lib/config';
import {
  BANGUMI_DATE_ORIGIN,
  readRemarks,
  writeRemarks,
} from '@/lib/video-remarks.server';

const CMLIUSSSS_BASE = 'https://img.doubanio.cmliussss.net';

type MinimalConfig = Awaited<ReturnType<typeof getConfig>>;

function getAuthorizedUsername(
  request: NextRequest,
  config: MinimalConfig,
): string | null {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) return null;
  if (authInfo.username === process.env.USERNAME) return authInfo.username;

  const user = config.UserConfig.Users.find(
    (item) => item.username === authInfo.username,
  );
  if (!user || user.banned) return null;
  return authInfo.username;
}

async function saveBangumiDateRemarkIfAllowed(
  request: NextRequest,
  config: MinimalConfig,
  bangumiId: string,
  date: unknown,
) {
  const remark = typeof date === 'string' ? date.trim() : '';
  if (!remark) return;

  const username = getAuthorizedUsername(request, config);
  if (!username) return;

  const remarks = await readRemarks(username);
  const remarkKey = `bangumi__${bangumiId}`;
  const existing = remarks[remarkKey];

  if (existing && existing.origin !== BANGUMI_DATE_ORIGIN) return;

  remarks[remarkKey] = {
    remark,
    updatedAt: Date.now(),
    origin: BANGUMI_DATE_ORIGIN,
  };
  await writeRemarks(username, remarks);
}

/**
 * Bangumi API 代理路由
 *
 * 用法:
 * GET /api/proxy/bangumi?path=calendar
 * GET /api/proxy/bangumi?path=v0/subjects/12345
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');

  if (!path) {
    return NextResponse.json(
      { error: 'Missing path parameter' },
      { status: 400 },
    );
  }

  try {
    const [adminConfig, cacheTime] = await Promise.all([
      getConfig(),
      getCacheTime(),
    ]);

    // 客户端可通过 query 参数覆盖 admin 配置（用于用户个人设置）
    const queryApiType = searchParams.get('apiType');
    const queryApiProxy = searchParams.get('apiProxy');
    const apiType =
      queryApiType || adminConfig.SiteConfig?.BangumiApiType || 'server';
    const apiProxy =
      queryApiProxy || adminConfig.SiteConfig?.BangumiApiProxy || '';

    let apiUrl: string;
    if (apiType === 'cmliussss') {
      apiUrl = `${CMLIUSSSS_BASE}/${path}`;
    } else if (apiType === 'custom' && apiProxy) {
      const base = apiProxy.endsWith('/') ? apiProxy.slice(0, -1) : apiProxy;
      apiUrl = `${base}/${path}`;
    } else {
      apiUrl = `https://api.bgm.tv/${path}`;
    }

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'LunaTV/1.0 (https://github.com/yourusername/LunaTV)',
        Accept: 'application/json',
      },
      next: { revalidate: cacheTime },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Bangumi API returned ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const subjectMatch = path.match(/^v0\/subjects\/(\d+)$/);
    if (subjectMatch) {
      saveBangumiDateRemarkIfAllowed(
        request,
        adminConfig,
        subjectMatch[1],
        data?.date,
      ).catch((error) => {
        console.warn('Bangumi date remark sync failed:', error);
      });
    }

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    console.error('Bangumi API proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Bangumi API' },
      { status: 500 },
    );
  }
}
