import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationProviderRegistry } from '@/lib/notification/notification-provider-bootstrap';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';

export const runtime = 'nodejs';

const testSchema = z
  .object({
    channelId: z.string(),
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

  const parsed = testSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return errorResponse('Invalid notification channel', 400);

  try {
    const settings = await notificationSettingsService.getForUser(
      admin.username,
    );
    const channel = settings.channels.find(
      (candidate) => candidate.id === parsed.data.channelId,
    );
    if (!channel) return errorResponse('Notification channel not found', 404);
    if (!settings.notificationCenterEnabled) {
      return errorResponse('Notification center disabled', 403);
    }
    if (!channel.enabled)
      return errorResponse('Notification channel disabled', 403);

    // Stage 2.5 API convergence: resolve the concrete implementation only through
    // NotificationProviderRegistry and call Provider.test().  Adding Telegram,
    // Webhook, Email, Bark, etc. should register a provider instead of changing this route.
    const provider = notificationProviderRegistry.get(channel.type);
    if (!provider)
      return errorResponse('Unsupported notification channel', 400);

    await provider.test({
      ...channel,
      config: {
        ...channel.config,
        userId: admin.username,
      },
    });

    return NextResponse.json(
      { success: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Failed to send notification test message', error);
    return errorResponse('Failed to send notification test message', 502);
  }
}
