import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { inboxNotificationService } from '@/lib/notification/inbox-notification-service';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    read: z.boolean(),
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

function mapServiceError(error: unknown, action: string) {
  if (error instanceof Error && error.message === 'NOTIFICATION_NOT_FOUND') {
    return errorResponse('Notification not found', 404);
  }

  console.error(`Failed to ${action} user notification`, error);
  return errorResponse(`Failed to ${action} user notification`, 500);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid notification request', 400);

  try {
    const { id } = await context.params;
    return jsonNoStore(
      await inboxNotificationService.markRead(username, id, parsed.data.read),
    );
  } catch (error) {
    return mapServiceError(error, 'update');
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
    await inboxNotificationService.delete(username, id);
    return jsonNoStore({ success: true });
  } catch (error) {
    return mapServiceError(error, 'delete');
  }
}
