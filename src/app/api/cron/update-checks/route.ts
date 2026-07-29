import { NextRequest, NextResponse } from 'next/server';

import { updateCheckScheduler } from '@/lib/update-check-scheduler';
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

  const startedAt = Date.now();
  const logRequest = getWatchingUpdateCheckLogRequestContext(
    request,
    undefined,
    undefined,
  ).request;
  const taskResults: UpdateResult[] = [];

  try {
    const result = await updateCheckScheduler.run({
      onTaskComplete: ({ result: taskResult }) => {
        if (taskResult) taskResults.push(taskResult);
      },
    });
    const endedAt = Date.now();
    try {
      await watchingUpdateCheckLogService.record({
        source: 'cron',
        operation: 'scheduled-check',
        request: logRequest,
        execution: {
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          success: true,
        },
        result: createWatchingUpdateCheckLogResult({
          checkedCount: result.inspected,
          successCount: result.succeeded,
          failureCount: result.failed,
          results: taskResults,
        }),
      });
    } catch (error) {
      console.error('Failed to record watching update check log', error);
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Update check scheduler failed', error);
    const endedAt = Date.now();
    try {
      await watchingUpdateCheckLogService.record({
        source: 'cron',
        operation: 'scheduled-check',
        request: logRequest,
        execution: {
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          success: false,
          error: errorMessage(error),
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
    return NextResponse.json(
      { success: false, error: 'Update check scheduler failed' },
      { status: 500 },
    );
  }
}
