import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationProviderRegistry } from '@/lib/notification/notification-provider-bootstrap';
import { getNotificationProviderPresentation } from '@/lib/notification/notification-provider-presentation';

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

  // ProviderRegistry is authoritative for supported types, validation schema and
  // capabilities. Presentation metadata contributes only descriptions/icons.
  const providers = notificationProviderRegistry.list().map((provider) => {
    const presentation = getNotificationProviderPresentation(provider.type);
    return {
      type: provider.type,
      displayName: provider.name,
      description: presentation.description,
      icon: presentation.icon,
      configSchema: provider.configSchema,
      capabilities: provider.capabilities,
      deliveryStatus: provider.capabilities.canSend ? 'active' : 'preview',
    };
  });

  return NextResponse.json({ providers }, { headers: noStoreHeaders });
}
