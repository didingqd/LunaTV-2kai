import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationDispatcher } from '@/lib/notification/notification-dispatcher';
import {
  createNotificationRunNowEvent,
  isNotificationRunNowEventType,
} from '@/lib/notification/notification-run-now';

export const runtime = 'nodejs';

const runNowSchema = z
  .object({
    eventType: z.string().refine(isNotificationRunNowEventType),
  })
  .strict();

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function requireNotificationSettingsAdmin(request: NextRequest) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username) return { error: errorResponse('Unauthorized', 401) };
  if (auth.role !== 'owner' && auth.role !== 'admin') {
    return { error: errorResponse('Forbidden', 403) };
  }
  return { username: auth.username };
}

export async function POST(request: NextRequest) {
  const admin = requireNotificationSettingsAdmin(request);
  if ('error' in admin) return admin.error;

  const parsed = runNowSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid notification event', 400);

  try {
    const event = createNotificationRunNowEvent(
      admin.username,
      parsed.data.eventType,
    );
    const result = await notificationDispatcher.dispatchEvent(event);

    return NextResponse.json(
      {
        eventType: event.type,
        success: result.success,
        totalChannels: result.totalChannels,
        succeeded: result.succeeded,
        failed: result.failed,
        errors: result.errors,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Failed to run notification debug event', error);
    return errorResponse('Failed to run notification debug event', 502);
  }
}
