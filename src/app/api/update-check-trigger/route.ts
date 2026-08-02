import { NextRequest, NextResponse } from 'next/server';

import {
  updateCheckJobRunner,
  type UpdateCheckJobStatusSnapshot,
  type UpdateCheckJobTriggerSource,
} from '@/lib/scheduler/update-check-job-runner';
import {
  triggerTokenService,
  type TriggerTokenVerifyResult,
} from '@/lib/trigger-token-service';
import { getWatchingUpdateCheckLogRequestContext } from '@/lib/watching-update-check-log-request';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function isStatusOnly(request: NextRequest): boolean {
  const value = new URL(request.url).searchParams.get('status');
  return value === '1' || value === 'true';
}

function getTriggerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) return token;
  }

  const queryToken = new URL(request.url).searchParams.get('token')?.trim();
  return queryToken || null;
}

async function verifyTriggerToken(
  request: NextRequest,
): Promise<TriggerTokenVerifyResult | { error: string; status: number }> {
  const token = getTriggerToken(request);
  if (!token) return { error: 'invalid_token', status: 401 };
  try {
    return await triggerTokenService.verify(token);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'TRIGGER_TOKEN_DISABLED') {
        return { error: 'trigger_link_disabled', status: 403 };
      }
      if (error.message === 'TRIGGER_TOKEN_EXPIRED') {
        return { error: 'token_expired', status: 401 };
      }
    }
    return { error: 'invalid_token', status: 401 };
  }
}

function requestedTriggerSource(
  request: NextRequest,
): UpdateCheckJobTriggerSource {
  const value = request.headers.get('x-lunatv-trigger-source')?.trim();
  if (value === 'manual' || value === 'admin') return value;
  return 'external_http';
}

function responseFromStatus(
  snapshot: UpdateCheckJobStatusSnapshot,
  accepted: boolean,
) {
  return {
    success: true,
    accepted,
    status: snapshot.status,
    running: snapshot.running,
    taskId: snapshot.taskId,
    trigger: snapshot.trigger,
    triggerSource: snapshot.triggerSource,
    ...(snapshot.tokenId ? { tokenId: snapshot.tokenId } : {}),
    ...(snapshot.userId ? { userId: snapshot.userId } : {}),
    ...(snapshot.requestedBy ? { requestedBy: snapshot.requestedBy } : {}),
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    durationMs: snapshot.durationMs,
    result: snapshot.result,
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

export async function GET(request: NextRequest) {
  const verified = await verifyTriggerToken(request);
  if ('error' in verified) {
    return noStoreJson(
      { success: false, error: verified.error },
      verified.status,
    );
  }

  if (isStatusOnly(request)) {
    return noStoreJson(
      responseFromStatus(updateCheckJobRunner.getStatus(), false),
    );
  }

  const current = updateCheckJobRunner.getStatus();
  if (current.running) {
    return noStoreJson(responseFromStatus(current, false));
  }

  const triggerSource = requestedTriggerSource(request);
  const logRequest = getWatchingUpdateCheckLogRequestContext(
    request,
    verified.userId,
    undefined,
  ).request;
  const status = updateCheckJobRunner.runInBackground({
    trigger: 'cron',
    triggerSource,
    tokenId: verified.tokenId,
    requestedBy: verified.userId,
    audit: {
      source: 'trigger',
      operation: 'scheduled-check',
      request: {
        ...logRequest,
        tokenId: verified.tokenId,
        requestedBy: verified.userId,
        trigger: triggerSource,
      },
      userIds: [verified.userId],
    },
  });

  return noStoreJson(responseFromStatus(status, status.running));
}
