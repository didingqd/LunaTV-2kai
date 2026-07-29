import { NextRequest } from 'next/server';
import { z } from 'zod';

import { updateCheckCapabilityService } from '@/lib/update-check-capability';
import { updateCheckService } from '@/lib/update-check-service';
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

const checkSchema = z
  .object({
    followIds: z.array(z.string().trim().min(1).max(2048)).max(200).optional(),
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
        source: context.source,
        operation: 'check',
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
    const parsed = checkSchema.safeParse(body);
    if (!parsed.success) {
      await recordLog({
        success: false,
        error: 'Invalid update check request',
      });
      return noStoreJson(
        { error: 'Invalid update check request', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const capability = await updateCheckCapabilityService.getCapability(
      auth.username,
    );
    if (!capability.enabled) {
      await recordLog({ success: true });
      return noStoreJson({
        userId: auth.username,
        status: capability.reason,
        reason: capability.reason,
        capability,
        checkedAt: Date.now(),
        results: [],
        errors: [],
      });
    }

    const batch = await updateCheckService.checkUser(
      auth.username,
      parsed.data.followIds,
    );
    await recordLog({
      success: true,
      checkedCount: batch.results.length + batch.errors.length,
      successCount: batch.results.length,
      failureCount: batch.errors.length,
      results: batch.results,
    });
    return noStoreJson({
      userId: auth.username,
      capability,
      checkedAt: Date.now(),
      ...batch,
    });
  } catch (error) {
    await recordLog({
      success: false,
      error: errorMessage(error),
    });
    return internalError(error);
  }
}
