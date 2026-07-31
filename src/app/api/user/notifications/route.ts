import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { inboxNotificationService } from '@/lib/notification/inbox-notification-service';

export const runtime = 'nodejs';

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

export async function GET(request: NextRequest) {
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  try {
    return jsonNoStore(await inboxNotificationService.listForUser(username));
  } catch (error) {
    console.error('Failed to read user notifications', error);
    return errorResponse('Failed to read user notifications', 500);
  }
}

export async function DELETE(request: NextRequest) {
  const username = getCurrentUser(request);
  if (!username) return errorResponse('Unauthorized', 401);

  try {
    await inboxNotificationService.clearForUser(username);
    return jsonNoStore({
      success: true,
      notifications: [],
      total: 0,
      unread: 0,
    });
  } catch (error) {
    console.error('Failed to clear user notifications', error);
    return errorResponse('Failed to clear user notifications', 500);
  }
}
