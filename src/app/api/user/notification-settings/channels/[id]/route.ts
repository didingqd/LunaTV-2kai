import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    config: z
      .object({
        webhookUrl: z.string().optional(),
      })
      .strict()
      .optional(),
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
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid notification channel', 400);

  try {
    const { id } = await context.params;
    const settings = await notificationSettingsService.updateChannel(
      username,
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
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  try {
    const { id } = await context.params;
    const settings = await notificationSettingsService.deleteChannel(username, id);
    return jsonNoStore({
      settings: notificationSettingsService.toPublicSettings(settings),
    });
  } catch (error) {
    return mapSettingsError(error, 'delete');
  }
}
