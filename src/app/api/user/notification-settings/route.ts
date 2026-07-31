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

function getCurrentUser(request: NextRequest) {
  const username = getAuthInfoFromCookie(request)?.username;
  if (!username) return null;
  return username;
}

function settingsResponse(settings: unknown) {
  return jsonNoStore({
    settings: notificationSettingsService.toPublicSettings(settings as never),
  });
}

export async function GET(request: NextRequest) {
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  try {
    return settingsResponse(await notificationSettingsService.getForUser(username));
  } catch (error) {
    console.error('Failed to read notification settings', error);
    return errorResponse('Failed to read notification settings', 500);
  }
}

export async function PATCH(request: NextRequest) {
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid notification settings', 400);

  try {
    return settingsResponse(
      await notificationSettingsService.save(username, parsed.data),
    );
  } catch (error) {
    console.error('Failed to update notification settings', error);
    return errorResponse('Failed to update notification settings', 500);
  }
}

export async function DELETE(request: NextRequest) {
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  try {
    return settingsResponse(
      await notificationSettingsService.restoreDefault(username),
    );
  } catch (error) {
    console.error('Failed to restore notification settings', error);
    return errorResponse('Failed to restore notification settings', 500);
  }
}
