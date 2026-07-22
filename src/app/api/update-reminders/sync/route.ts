import { NextRequest } from 'next/server';
import { z } from 'zod';

import { updateCheckService } from '@/lib/update-check-service';
import {
  internalError,
  noStoreJson,
  parseJsonBody,
  requireWatchingFollowUser,
} from '../route-utils';

export const runtime = 'nodejs';

const observationSchema = z
  .object({
    followId: z.string().trim().min(1).max(2048),
    source: z.string().trim().min(1).max(512),
    resourceId: z.string().trim().min(1).max(512),
    latestEpisode: z.number().int().nonnegative(),
    observedAt: z.number().int().positive().optional(),
    clientId: z.string().trim().max(256).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const syncSchema = z
  .object({
    observations: z.array(observationSchema).min(1).max(200),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireWatchingFollowUser(request);
    if (auth.response) return auth.response;

    const parsed = syncSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        {
          error: 'Invalid update observation request',
          issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const accepted = [];
    const rejected = [];
    for (const observation of parsed.data.observations) {
      const result = await updateCheckService.processObservation({
        userId: auth.username,
        followId: observation.followId,
        source: observation.source,
        resourceId: observation.resourceId,
        latestEpisode: observation.latestEpisode,
        observedAt: observation.observedAt ?? Date.now(),
        clientId: observation.clientId,
        metadata: observation.metadata,
      });
      if (result) accepted.push(result);
      else
        rejected.push({
          followId: observation.followId,
          reason: 'Follow or PlayRecord is invalid',
        });
    }

    return noStoreJson({
      userId: auth.username,
      syncedAt: Date.now(),
      accepted,
      rejected,
    });
  } catch (error) {
    return internalError(error);
  }
}
