import { NextRequest, NextResponse } from 'next/server';

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { notificationSendLogRepository } from '@/lib/notification/notification-log-repository';
import {
  MAX_NOTIFICATION_LOG_LIMIT,
  DEFAULT_NOTIFICATION_LOG_LIMIT,
} from '@/lib/notification/notification-log-types';

export const runtime = 'nodejs';

function parseLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_NOTIFICATION_LOG_LIMIT;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_NOTIFICATION_LOG_LIMIT
    ? parsed
    : null;
}

export async function GET(request: NextRequest) {
  const role = await getAdminRoleFromRequest(request);
  if (!role) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = parseLimit(searchParams.get('limit'));
  if (limit === null) {
    return NextResponse.json(
      { error: 'Invalid query parameters' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const logs = await notificationSendLogRepository.list({ limit });
    return NextResponse.json(
      {
        logs: logs.map((log) => ({
          eventType: log.eventType,
          provider: log.providerType,
          channelId: log.channelId,
          status: log.status,
          error: log.error,
          time: log.createdAt,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Failed to read notification logs', error);
    return NextResponse.json(
      { error: 'Failed to read notification logs' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
