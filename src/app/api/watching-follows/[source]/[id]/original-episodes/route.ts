/* eslint-disable no-console */

import { NextRequest } from 'next/server';

import { db } from '@/lib/db';
import { updateCheckService } from '@/lib/update-check-service';
import { watchingFollowOriginalEpisodesAdvanceSchema } from '@/lib/watching-follow';

import { noStoreJson, requireWatchingFollowUser } from '../../../route-utils';

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

export async function POST(request: NextRequest, { params }: RouteContext) {
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

    const parsed = watchingFollowOriginalEpisodesAdvanceSchema.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
        {
          error: 'Invalid WatchingFollow originalEpisodes advance',
          issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const result = await db.advanceWatchingFollowOriginalEpisodes(
      auth.username,
      source,
      id,
      parsed.data.originalEpisodes,
    );
    if (!result.found || !result.follow) {
      return noStoreJson(
        { error: 'WatchingFollow not found' },
        { status: 404 },
      );
    }

    // Manual "watched to latest" is a follow-confirmation action, not a
    // playback-history action. The request-provided episode count is the latest
    // value already verified by the caller, so use it only to refresh the
    // existing Watching Update result after the monotonic baseline write.
    if (result.changed) {
      await updateCheckService.refreshResultAfterBaselineAdvance({
        userId: auth.username,
        source,
        resourceId: id,
        latestEpisode: result.originalEpisodes,
      });
    }

    return noStoreJson({
      ...result.follow,
      baselineChanged: result.changed,
      previousOriginalEpisodes: result.previousEpisodes,
    });
  } catch (error) {
    console.error('推进追更确认基线失败', error);
    return noStoreJson({ error: 'Internal Server Error' }, { status: 500 });
  }
}
