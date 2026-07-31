import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    inboxEnabled: z.boolean().optional(),
    watchingUpdateFoundEnabled: z.boolean().optional(),
    watchingUpdateFailedEnabled: z.boolean().optional(),
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

function getCurrentAuth(request: NextRequest) {
  return getAuthInfoFromCookie(request);
}

function isNotificationSettingsAdmin(
  auth: ReturnType<typeof getAuthInfoFromCookie>,
) {
  return auth?.role === 'owner' || auth?.role === 'admin';
}

function requireNotificationSettingsAdmin(request: NextRequest) {
  const auth = getCurrentAuth(request);
  if (!auth?.username) return { error: errorResponse('Unauthorized', 401) };
  if (!isNotificationSettingsAdmin(auth)) {
    return { error: errorResponse('Forbidden', 403) };
  }
  return { username: auth.username };
}

function settingsResponse(settings: unknown) {
  return jsonNoStore({
    settings: notificationSettingsService.toPublicSettings(settings as never),
  });
}

export async function GET(request: NextRequest) {
  const admin = requireNotificationSettingsAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    return settingsResponse(await notificationSettingsService.getForUser(admin.username));
  } catch (error) {
    console.error('Failed to read notification settings', error);
    return errorResponse('Failed to read notification settings', 500);
  }
}

export async function PATCH(request: NextRequest) {
  const admin = requireNotificationSettingsAdmin(request);
  if ('error' in admin) return admin.error;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid notification settings', 400);

  try {
    return settingsResponse(
      await notificationSettingsService.save(admin.username, parsed.data),
    );
  } catch (error) {
    console.error('Failed to update notification settings', error);
    return errorResponse('Failed to update notification settings', 500);
  }
}

export async function DELETE(request: NextRequest) {
  const admin = requireNotificationSettingsAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    return settingsResponse(
      await notificationSettingsService.restoreDefault(admin.username),
    );
  } catch (error) {
    console.error('Failed to restore notification settings', error);
    return errorResponse('Failed to restore notification settings', 500);
  }
}
