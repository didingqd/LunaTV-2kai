/* eslint-disable no-console */

import { NextRequest } from 'next/server';

import { db } from '@/lib/db';
import { updateCheckService } from '@/lib/update-check-service';
import {
  updateWatchingFollow,
  watchingFollowUpdateSchema,
} from '@/lib/watching-follow';

import { noStoreJson, requireWatchingFollowUser } from '../../route-utils';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ source: string; id: string }>;
}

function validateIdentity(source: string, id: string) {
  return (
    source.trim().length > 0 &&
    source.length <= 512 &&
    id.trim().length > 0 &&
    id.length <= 512
  );
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireWatchingFollowUser(request);
    if (auth.response) return auth.response;

    const { source, id } = await params;
    if (!validateIdentity(source, id)) {
      return noStoreJson({ error: 'Invalid source or id' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (
      typeof body === 'object' &&
      body !== null &&
      Object.prototype.hasOwnProperty.call(body, 'originalEpisodes')
    ) {
      return noStoreJson(
        { error: 'originalEpisodes is immutable' },
        { status: 400 },
      );
    }

    const parsed = watchingFollowUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
        { error: 'Invalid WatchingFollow update', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const existing = await db.getWatchingFollow(auth.username, source, id);
    if (!existing) {
      return noStoreJson(
        { error: 'WatchingFollow not found' },
        { status: 404 },
      );
    }

    const follow = updateWatchingFollow(existing, parsed.data);
    await db.saveWatchingFollow(auth.username, source, id, follow);
    await updateCheckService.onFollowUpdated(follow, auth.username);

    return noStoreJson(follow);
  } catch (error) {
    console.error('更新追更关注失败', error);
    return noStoreJson({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireWatchingFollowUser(request);
    if (auth.response) return auth.response;

    const { source, id } = await params;
    if (!validateIdentity(source, id)) {
      return noStoreJson({ error: 'Invalid source or id' }, { status: 400 });
    }

    await db.deleteWatchingFollow(auth.username, source, id);
    await updateCheckService.onFollowDeleted(auth.username, source, id);
    return noStoreJson({ success: true });
  } catch (error) {
    console.error('删除追更关注失败', error);
    return noStoreJson({ error: 'Internal Server Error' }, { status: 500 });
  }
}
