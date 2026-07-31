import { NextRequest, NextResponse } from 'next/server';

import {
  manualTriggerUseCase,
  ManualTriggerUseCaseError,
} from '@/lib/manual-trigger-use-case';
import type { UpdateCheckJobRunnerResult } from '@/lib/scheduler/update-check-job-runner';
import { triggerTokenService } from '@/lib/trigger-token-service';
import {
  createWatchingUpdateCheckLogResult,
  watchingUpdateCheckLogService,
} from '@/lib/watching-update-check-log-service';
import { getWatchingUpdateCheckLogRequestContext } from '@/lib/watching-update-check-log-request';
import type { WatchingUpdateCheckLogRequest } from '@/lib/watching-update-check-log-types';

export const runtime = 'nodejs';

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { success: false, error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function successResponse(body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function getTriggerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    return token || null;
  }

  const headerToken = request.headers.get('x-trigger-token')?.trim();
  return headerToken || null;
}

function triggerAuditRequest(
  request: NextRequest,
  userId: string | undefined,
): WatchingUpdateCheckLogRequest {
  const context = getWatchingUpdateCheckLogRequestContext(
    request,
    userId,
    undefined,
  );
  return {
    ...context.request,
    ...(userId ? { requestedBy: userId } : {}),
    trigger: 'manual',
  };
}

function verifyErrorCode(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function recordTriggerFailureLog({
  request,
  startedAt,
  error,
  userId,
}: {
  request: NextRequest;
  startedAt: number;
  error: string;
  userId?: string;
}): Promise<void> {
  const finishedAt = Date.now();
  try {
    await watchingUpdateCheckLogService.record(
      {
        source: 'trigger',
        operation: 'manual-trigger',
        request: triggerAuditRequest(request, userId),
        execution: {
          stage: 'finished',
          startedAt,
          endedAt: finishedAt,
          finishedAt,
          durationMs: Math.max(0, finishedAt - startedAt),
          success: false,
          error,
        },
        result: createWatchingUpdateCheckLogResult({
          checkedCount: 0,
          successCount: 0,
          failureCount: 0,
        }),
      },
      userId ? { userIds: [userId] } : {},
    );
  } catch (logError) {
    console.error('Failed to record watching update trigger failure log', logError);
  }
}

function mapVerifyError(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === 'TRIGGER_TOKEN_INVALID' ||
      error.message === 'TRIGGER_TOKEN_DISABLED' ||
      error.message === 'TRIGGER_TOKEN_EXPIRED' ||
      error.message === 'TRIGGER_TOKEN_NOT_FOUND'
    ) {
      return errorResponse('Invalid trigger token', 401);
    }
  }
  console.error('Failed to verify trigger token', error);
  return errorResponse('Failed to verify trigger token', 500);
}

function mapUseCaseError(error: unknown) {
  if (error instanceof ManualTriggerUseCaseError) {
    if (error.code === 'USER_NOT_FOUND') {
      return errorResponse('User not found', 404);
    }
    return errorResponse('Trigger is not allowed', 403);
  }
  console.error('Manual trigger failed', error);
  return errorResponse('Manual trigger failed', 500);
}

function responseFromJobResult(jobResult: UpdateCheckJobRunnerResult) {
  if (jobResult.error === 'UPDATE_CHECK_ALREADY_RUNNING') {
    return successResponse({
      success: true,
      running: true,
      trigger: jobResult.trigger,
      startedAt: jobResult.startedAt,
      finishedAt: jobResult.finishedAt,
      durationMs: jobResult.durationMs,
    });
  }

  if (!jobResult.success || !jobResult.schedulerResult) {
    return errorResponse('Manual trigger failed', 500);
  }

  return successResponse({
    success: true,
    running: jobResult.running,
    trigger: jobResult.trigger,
    startedAt: jobResult.startedAt,
    finishedAt: jobResult.finishedAt,
    durationMs: jobResult.durationMs,
    inspected: jobResult.schedulerResult.inspected,
    succeeded: jobResult.schedulerResult.succeeded,
    failed: jobResult.schedulerResult.failed,
    oldestDueAt: jobResult.schedulerResult.oldestDueAt,
  });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const token = getTriggerToken(request);
  if (!token) {
    await recordTriggerFailureLog({
      request,
      startedAt,
      error: 'TRIGGER_TOKEN_NOT_FOUND',
    });
    return errorResponse('Invalid trigger token', 401);
  }

  let verified;
  try {
    verified = await triggerTokenService.verify(token);
  } catch (error) {
    await recordTriggerFailureLog({
      request,
      startedAt,
      error: verifyErrorCode(error),
    });
    return mapVerifyError(error);
  }

  try {
    /**
     * Stage 4H-H: pass only sanitized request context to the use case; token
     * id/secret are intentionally excluded so audit logs prove the trigger
     * source without persisting credentials.
     */
    const result = await manualTriggerUseCase.execute(verified.userId, {
      auditRequest: triggerAuditRequest(request, verified.userId),
    });
    return responseFromJobResult(result.jobResult);
  } catch (error) {
    await recordTriggerFailureLog({
      request,
      startedAt,
      error:
        error instanceof ManualTriggerUseCaseError
          ? error.code
          : verifyErrorCode(error),
      userId: verified.userId,
    });
    return mapUseCaseError(error);
  }
}
