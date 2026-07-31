import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { WeChatWorkNotificationChannel } from '@/lib/notification/channels/wechat-work-notification-channel';
import { NotificationChannelType } from '@/lib/notification/notification-settings-repository';
import { notificationSettingsService } from '@/lib/notification/notification-settings-service';
import { NotificationMessageType } from '@/lib/notification/notification-types';

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

function getCurrentUser(request: NextRequest) {
  const username = getAuthInfoFromCookie(request)?.username;
  if (!username) return null;
  return username;
}

export async function POST(request: NextRequest) {
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  const parsed = testSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid notification channel', 400);

  try {
    const settings = await notificationSettingsService.getForUser(username);
    const channel = settings.channels.find(
      (candidate) => candidate.id === parsed.data.channelId,
    );
    if (!channel) return errorResponse('Notification channel not found', 404);
    if (channel.type !== NotificationChannelType.WECHAT_WORK) {
      return errorResponse('Unsupported notification channel', 400);
    }
    if (!channel.enabled) return errorResponse('Notification channel disabled', 403);
    if (typeof channel.config.webhookUrl !== 'string') {
      return errorResponse('Webhook URL is required', 400);
    }

    await new WeChatWorkNotificationChannel(channel.config).send({
      userId: username,
      type: NotificationMessageType.SYSTEM,
      title: '测试通知',
      content: '这是一条企业微信通知测试消息。',
      createdAt: Date.now(),
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
