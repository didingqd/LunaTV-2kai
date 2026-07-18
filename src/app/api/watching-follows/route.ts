/* eslint-disable no-console */

import { NextRequest } from 'next/server';

import { db } from '@/lib/db';
import {
  createWatchingFollow,
  watchingFollowCreateSchema,
} from '@/lib/watching-follow';

import { noStoreJson, requireWatchingFollowUser } from './route-utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireWatchingFollowUser(request);
    if (auth.response) return auth.response;

    const follows = await db.getAllWatchingFollows(auth.username);
    return noStoreJson(follows);
  } catch (error) {
    console.error('获取追更关注失败', error);
    return noStoreJson({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireWatchingFollowUser(request);
    if (auth.response) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = watchingFollowCreateSchema.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
        { error: 'Invalid WatchingFollow data', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { source, id } = parsed.data;
    const existing = await db.getWatchingFollow(auth.username, source, id);
    if (existing) {
      return noStoreJson(
        { error: 'WatchingFollow already exists' },
        { status: 409 },
      );
    }

    const follow = createWatchingFollow(parsed.data);
    await db.saveWatchingFollow(auth.username, source, id, follow);

    return noStoreJson(follow, { status: 201 });
  } catch (error) {
    console.error('创建追更关注失败', error);
    return noStoreJson({ error: 'Internal Server Error' }, { status: 500 });
  }
}
