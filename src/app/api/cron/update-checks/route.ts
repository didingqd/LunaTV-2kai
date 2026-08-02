import { NextRequest, NextResponse } from 'next/server';

import { updateCheckJobRunner } from '@/lib/scheduler/update-check-job-runner';
import { getWatchingUpdateCheckLogRequestContext } from '@/lib/watching-update-check-log-request';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const logRequest = getWatchingUpdateCheckLogRequestContext(
    request,
    undefined,
    undefined,
  ).request;

  try {
    const jobResult = await updateCheckJobRunner.run({
      trigger: 'cron',
      triggerSource: 'cron_vercel',
      requestedBy: 'vercel',
      /**
       * Stage 4H-H: Vercel Cron no longer writes route-level duplicate logs;
       * the HTTP request context is handed to JobRunner so the same execution
       * audit format is shared with Docker Scheduler and trigger-link runs.
       */
      audit: {
        source: 'cron',
        operation: 'scheduled-check',
        request: logRequest,
      },
    });

    if (jobResult.error === 'UPDATE_CHECK_ALREADY_RUNNING') {
      return NextResponse.json(
        {
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
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    if (!jobResult.success || !jobResult.schedulerResult) {
      return NextResponse.json(
        { success: false, error: 'Update check scheduler failed' },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        success: true,
        ...jobResult.schedulerResult,
        running: jobResult.running,
        trigger: jobResult.trigger,
        durationMs: jobResult.durationMs,
        startedAt: jobResult.startedAt,
        finishedAt: jobResult.finishedAt,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Update check scheduler failed', error);
    return NextResponse.json(
      { success: false, error: 'Update check scheduler failed' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
