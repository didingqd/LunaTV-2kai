import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

type AuthResult =
  | { username: string; response?: never }
  | { username?: never; response: NextResponse };

export async function requireWatchingFollowUser(
  request: NextRequest,
): Promise<AuthResult> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (authInfo.username === process.env.USERNAME) {
    return { username: authInfo.username };
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === authInfo.username,
  );

  if (!user) {
    return {
      response: NextResponse.json({ error: '用户不存在' }, { status: 401 }),
    };
  }

  if (user.banned) {
    return {
      response: NextResponse.json({ error: '用户已被封禁' }, { status: 401 }),
    };
  }

  return { username: authInfo.username };
}

export function noStoreJson(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
