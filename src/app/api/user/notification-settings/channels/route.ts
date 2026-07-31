import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';

export const runtime = 'nodejs';

const createSchema = z
  .object({
    type: z.literal('wechat_work'),
    name: z.string().optional(),
    config: z
      .object({
        webhookUrl: z.string(),
      })
      .strict(),
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
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid notification channel', 400);

  try {
    const settings = await notificationSettingsService.createChannel(
      username,
      {
        type: parsed.data.type,
        name: parsed.data.name,
        config: {
          webhookUrl: parsed.data.config.webhookUrl,
        },
      },
    );
    return jsonNoStore({
      settings: notificationSettingsService.toPublicSettings(settings),
    });
  } catch (error) {
    return mapSettingsError(error);
  }
}
