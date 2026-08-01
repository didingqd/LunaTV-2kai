import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import '@/lib/notification-event-bootstrap';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';

export const runtime = 'nodejs';

const createSchema = z
  .object({
    type: z.string().min(1),
    name: z.string().optional(),
    subscribedEvents: z.array(z.string().min(1)).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const noStoreHeaders = { 'Cache-Control': 'private, no-store' };

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

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

function mapSettingsError(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === 'UNSUPPORTED_NOTIFICATION_CHANNEL_TYPE' ||
      error.message === 'INVALID_NOTIFICATION_CHANNEL_CONFIG'
    ) {
      return errorResponse('Invalid notification channel', 400);
    }
  }

  console.error('Failed to create notification channel', error);
  return errorResponse('Failed to create notification channel', 500);
}

export async function POST(request: NextRequest) {
  const admin = requireNotificationSettingsAdmin(request);
  if ('error' in admin) return admin.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return errorResponse('Invalid notification channel', 400);

  try {
    const settings = await notificationSettingsService.createChannel(
      admin.username,
      {
        type: parsed.data.type,
        name: parsed.data.name,
        subscribedEvents: parsed.data.subscribedEvents,
        config: parsed.data.config,
      },
    );
    return jsonNoStore({
      settings: notificationSettingsService.toPublicSettings(settings),
    });
  } catch (error) {
    return mapSettingsError(error);
  }
}
