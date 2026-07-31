import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
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

function mapSettingsError(error: unknown, action: string) {
  if (error instanceof Error) {
    if (error.message === 'NOTIFICATION_CHANNEL_NOT_FOUND') {
      return errorResponse('Notification channel not found', 404);
    }
    if (error.message === 'BUILTIN_NOTIFICATION_CHANNEL') {
      return errorResponse('Built-in notification channel cannot be deleted', 400);
    }
    if (
      error.message === 'UNSUPPORTED_NOTIFICATION_CHANNEL_TYPE' ||
      error.message === 'INVALID_NOTIFICATION_CHANNEL_CONFIG'
    ) {
      return errorResponse('Invalid notification channel', 400);
    }
  }

  console.error(`Failed to ${action} notification channel`, error);
  return errorResponse(`Failed to ${action} notification channel`, 500);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = requireNotificationSettingsAdmin(request);
  if ('error' in admin) return admin.error;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid notification channel', 400);

  try {
    const { id } = await context.params;
    const settings = await notificationSettingsService.updateChannel(
      admin.username,
      id,
      parsed.data,
    );
    return jsonNoStore({
      settings: notificationSettingsService.toPublicSettings(settings),
    });
  } catch (error) {
    return mapSettingsError(error, 'update');
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = requireNotificationSettingsAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    const { id } = await context.params;
    const settings = await notificationSettingsService.deleteChannel(admin.username, id);
    return jsonNoStore({
      settings: notificationSettingsService.toPublicSettings(settings),
    });
  } catch (error) {
    return mapSettingsError(error, 'delete');
  }
}
