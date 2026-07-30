import { NextRequest, NextResponse } from 'next/server';

import { updateCheckJobRunner } from '@/lib/scheduler/update-check-job-runner';
import type { UpdateResult } from '@/lib/update-check-types';
import {
  createWatchingUpdateCheckLogResult,
  errorMessage,
  watchingUpdateCheckLogService,
} from '@/lib/watching-update-check-log-service';
import { getWatchingUpdateCheckLogRequestContext } from '@/lib/watching-update-check-log-request';

export const runtime = 'nodejs';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logRequest = getWatchingUpdateCheckLogRequestContext(
    request,
    undefined,
    undefined,
  ).request;
  const taskResults: UpdateResult[] = [];
  const taskUserIds = new Set<string>();

  try {
    const jobResult = await updateCheckJobRunner.run({
      trigger: 'cron',
      requestedBy: 'vercel',
      onTaskComplete: ({ task, result: taskResult }) => {
        taskUserIds.add(task.userId);
        if (taskResult) taskResults.push(taskResult);
      },
    });

    if (jobResult.error === 'UPDATE_CHECK_ALREADY_RUNNING') {
      return NextResponse.json({
        success: true,
        running: true,
        trigger: jobResult.trigger,
        durationMs: jobResult.durationMs,
        startedAt: jobResult.startedAt,
        finishedAt: jobResult.finishedAt,
        inspected: 0,
        succeeded: 0,
        failed: 0,
        oldestDueAt: null,
      });
    }

    if (!jobResult.success || !jobResult.schedulerResult) {
      await recordFailureLog(
        logRequest,
        jobResult.startedAt,
        jobResult.finishedAt,
        jobResult.error ?? 'Update check scheduler failed',
      );
      return NextResponse.json(
        { success: false, error: 'Update check scheduler failed' },
        { status: 500 },
      );
    }

    try {
      await watchingUpdateCheckLogService.record(
        {
          source: 'cron',
          operation: 'scheduled-check',
          request: logRequest,
          execution: {
            startedAt: jobResult.startedAt,
            endedAt: jobResult.finishedAt,
            durationMs: jobResult.durationMs,
            success: true,
          },
          result: createWatchingUpdateCheckLogResult({
            checkedCount: jobResult.schedulerResult.inspected,
            successCount: jobResult.schedulerResult.succeeded,
            failureCount: jobResult.schedulerResult.failed,
            results: taskResults,
          }),
        },
        {
          userIds: Array.from(taskUserIds),
        },
      );
    } catch (error) {
      console.error('Failed to record watching update check log', error);
    }
    return NextResponse.json({
      success: true,
      ...jobResult.schedulerResult,
      running: jobResult.running,
      trigger: jobResult.trigger,
      durationMs: jobResult.durationMs,
      startedAt: jobResult.startedAt,
      finishedAt: jobResult.finishedAt,
    });
  } catch (error) {
    console.error('Update check scheduler failed', error);
    const failedAt = Date.now();
    await recordFailureLog(logRequest, failedAt, failedAt, errorMessage(error));
    return NextResponse.json(
      { success: false, error: 'Update check scheduler failed' },
      { status: 500 },
    );
  }
}

async function recordFailureLog(
  logRequest: ReturnType<
    typeof getWatchingUpdateCheckLogRequestContext
  >['request'],
  startedAt: number,
  endedAt: number,
  error: string,
) {
  try {
    await watchingUpdateCheckLogService.record({
      source: 'cron',
      operation: 'scheduled-check',
      request: logRequest,
      execution: {
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        success: false,
        error,
      },
      result: createWatchingUpdateCheckLogResult({
        checkedCount: 0,
        successCount: 0,
        failureCount: 0,
      }),
    });
  } catch (logError) {
    console.error('Failed to record watching update check log', logError);
  }
}
