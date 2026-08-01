import { NextRequest, NextResponse } from 'next/server';

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { schedulerManager } from '@/lib/scheduler/scheduler-manager';
import type { UpdateCheckJobRunnerResult } from '@/lib/scheduler/update-check-job-runner';
import { getWatchingUpdateCheckLogRequestContext } from '@/lib/watching-update-check-log-request';

export const runtime = 'nodejs';

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { success: false, error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function buildRunNowResponse(jobResult: UpdateCheckJobRunnerResult) {
  const schedulerResult = jobResult.schedulerResult;
  const base = {
    success: jobResult.success,
    running: jobResult.running,
    trigger: jobResult.trigger,
    startedAt: jobResult.startedAt,
    finishedAt: jobResult.finishedAt,
    durationMs: jobResult.durationMs,
    ...(jobResult.error ? { error: jobResult.error } : {}),
  };

  if (!schedulerResult) {
    return {
      ...base,
      checkedCount: 0,
      dataSourceCount: 0,
      updateFoundCount: 0,
      updateSuccessCount: 0,
      notificationCount: 0,
      skippedCount: 0,
      failedCount: 0,
      oldestDueAt: null,
    };
  }

  return {
    ...base,
    checkedCount: schedulerResult.inspected,
    dataSourceCount: schedulerResult.dataSourceCount,
    updateFoundCount: schedulerResult.updateFoundCount,
    updateSuccessCount: schedulerResult.succeeded,
    notificationCount: schedulerResult.notificationCount,
    skippedCount: schedulerResult.skipped,
    failedCount: schedulerResult.failed,
    oldestDueAt: schedulerResult.oldestDueAt,
    inspected: schedulerResult.inspected,
    succeeded: schedulerResult.succeeded,
    failed: schedulerResult.failed,
    skipped: schedulerResult.skipped,
  };
}

export async function POST(request: NextRequest) {
  const role = await getAdminRoleFromRequest(request);
  if (!role) return errorResponse('Unauthorized', 403);

  const operator = getAuthInfoFromCookie(request)?.username ?? role;
  const logRequest = getWatchingUpdateCheckLogRequestContext(
    request,
    operator,
    undefined,
  ).request;

  try {
    const jobResult = await schedulerManager.runNow({
      trigger: 'manual',
      requestedBy: operator,
      ignoreSchedule: true,
      preserveNextCheckAt: true,
      audit: {
        source: 'admin',
        operation: 'manual-trigger',
        request: {
          ...logRequest,
          requestedBy: operator,
          trigger: 'manual',
        },
      },
    });

    return NextResponse.json(buildRunNowResponse(jobResult), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to run watching update check now', error);
    return errorResponse('Failed to run watching update check now', 500);
  }
}
