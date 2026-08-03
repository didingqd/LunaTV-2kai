import { NextRequest } from 'next/server';
import { z } from 'zod';

import { updateCheckCapabilityService } from '@/lib/update-check-capability';
import { updateCheckService } from '@/lib/update-check-service';
import {
  resolveUpdateResultNotificationTimezone,
  updateResultNotificationDispatcher,
} from '@/lib/update-result-notification-dispatcher';
import type { UpdateResult } from '@/lib/update-check-types';
import {
  createWatchingUpdateCheckLogResult,
  errorMessage,
  watchingUpdateCheckLogService,
} from '@/lib/watching-update-check-log-service';
import { getWatchingUpdateCheckLogRequestContext } from '@/lib/watching-update-check-log-request';
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
  const startedAt = Date.now();
  let userId: string | undefined;
  let body: unknown;

  const recordLog = async ({
    success,
    error,
    checkedCount = 0,
    successCount = 0,
    failureCount = 0,
    results,
  }: {
    success: boolean;
    error?: string;
    checkedCount?: number;
    successCount?: number;
    failureCount?: number;
    results?: Parameters<
      typeof createWatchingUpdateCheckLogResult
    >[0]['results'];
  }) => {
    const endedAt = Date.now();
    const context = getWatchingUpdateCheckLogRequestContext(
      request,
      userId,
      body,
    );
    try {
      await watchingUpdateCheckLogService.record({
        source: 'app',
        operation: 'sync',
        request: context.request,
        execution: {
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          success,
          ...(error ? { error } : {}),
        },
        result: createWatchingUpdateCheckLogResult({
          checkedCount,
          successCount,
          failureCount,
          results,
        }),
      });
    } catch (logError) {
      console.error('Failed to record watching update check log', logError);
    }
  };

  try {
    const auth = await requireWatchingFollowUser(request);
    if (auth.response) return auth.response;
    userId = auth.username;

    body = await parseJsonBody(request);
    const parsed = syncSchema.safeParse(body);
    if (!parsed.success) {
      await recordLog({
        success: false,
        error: 'Invalid update observation request',
      });
      return noStoreJson(
        {
          error: 'Invalid update observation request',
          issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const capability = await updateCheckCapabilityService.getCapability(
      auth.username,
    );
    if (!capability.enabled) {
      await recordLog({
        success: true,
        checkedCount: parsed.data.observations.length,
      });
      return noStoreJson({
        userId: auth.username,
        status: capability.reason,
        reason: capability.reason,
        capability,
        syncedAt: Date.now(),
        accepted: false,
        rejected: [],
      });
    }

    const accepted: UpdateResult[] = [];
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

    if (accepted.length > 0) {
      const checkedAt = Math.max(...accepted.map((result) => result.checkedAt));
      const timezone = await resolveUpdateResultNotificationTimezone(
        auth.username,
        checkedAt,
      );
      let allCurrentResults = accepted;
      try {
        const currentResults = await updateCheckService.getResultsForUser(
          auth.username,
        );
        if (currentResults.length > 0) allCurrentResults = currentResults;
      } catch (lookupError) {
        console.error(
          'App update sync notification result lookup failed',
          lookupError,
        );
      }
      await updateResultNotificationDispatcher.dispatchUpdateResultNotifications(
        {
          userId: auth.username,
          results: accepted,
          allCurrentResults,
          source: 'app',
          timezone,
        },
      );
    }

    await recordLog({
      success: true,
      checkedCount: parsed.data.observations.length,
      successCount: accepted.length,
      failureCount: rejected.length,
      results: accepted,
    });
    return noStoreJson({
      userId: auth.username,
      capability,
      syncedAt: Date.now(),
      accepted,
      rejected,
    });
  } catch (error) {
    await recordLog({
      success: false,
      error: errorMessage(error),
    });
    return internalError(error);
  }
}
