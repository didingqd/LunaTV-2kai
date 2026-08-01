import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { buildNotificationProvidersPayload } from '@/lib/notification/notification-provider-api';

export const runtime = 'nodejs';

const noStoreHeaders = { 'Cache-Control': 'private, no-store' };

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

export async function GET(request: NextRequest) {
  const admin = requireNotificationSettingsAdmin(request);
  if ('error' in admin) return admin.error;

  return NextResponse.json(await buildNotificationProvidersPayload(), {
    headers: noStoreHeaders,
  });
}
