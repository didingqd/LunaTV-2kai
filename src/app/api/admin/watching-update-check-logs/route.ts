import { NextRequest, NextResponse } from 'next/server';

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { watchingUpdateCheckLogService } from '@/lib/watching-update-check-log-service';
import {
  MAX_WATCHING_UPDATE_CHECK_LOG_LIMIT,
  DEFAULT_WATCHING_UPDATE_CHECK_LOG_LIMIT,
  type WatchingUpdateCheckLogSource,
} from '@/lib/watching-update-check-log-types';

export const runtime = 'nodejs';

function parseLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_WATCHING_UPDATE_CHECK_LOG_LIMIT;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_WATCHING_UPDATE_CHECK_LOG_LIMIT
    ? parsed
    : null;
}

function parseSource(
  value: string | null,
): WatchingUpdateCheckLogSource | undefined | null {
  // Stage 4H-H: keep query parsing aligned with the source union so the
  // admin endpoint can filter trigger-link audit records without special cases.
  if (value === null || value === '') return undefined;
  return value === 'cron' ||
    value === 'app' ||
    value === 'web' ||
    value === 'admin' ||
    value === 'trigger'
    ? value
    : null;
}

export async function GET(request: NextRequest) {
  const role = await getAdminRoleFromRequest(request);
  if (!role) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = parseLimit(searchParams.get('limit'));
  const source = parseSource(searchParams.get('source'));
  const userId = searchParams.get('userId')?.trim() || undefined;
  if (limit === null || source === null || (userId && userId.length > 256)) {
    return NextResponse.json(
      { error: 'Invalid query parameters' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const logs = await watchingUpdateCheckLogService.list({
      limit,
      source,
      userId,
    });
    return NextResponse.json(
      { logs, total: logs.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Failed to read watching update check logs', error);
    return NextResponse.json(
      { error: 'Failed to read watching update check logs' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
