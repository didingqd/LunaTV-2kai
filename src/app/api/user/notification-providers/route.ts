import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { notificationProviderRegistry } from '@/lib/notification/notification-provider-bootstrap';

export const runtime = 'nodejs';

const noStoreHeaders = { 'Cache-Control': 'private, no-store' };

const providerPresentation = new Map<
  string,
  {
    description: string;
    icon: string;
    capabilities: {
      canCreate: boolean;
      canEdit: boolean;
      canDelete: boolean;
      canTest: boolean;
      canToggle: boolean;
    };
  }
>([
  [
    'inbox',
    {
      description: '在 LunaTV 通知中心接收系统内消息。',
      icon: 'inbox',
      capabilities: {
        canCreate: false,
        canEdit: true,
        canDelete: false,
        canTest: true,
        canToggle: true,
      },
    },
  ],
  [
    'wechat_work',
    {
      description: '通过企业微信群机器人 Webhook 推送外部通知。',
      icon: 'building-2',
      capabilities: {
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canTest: true,
        canToggle: true,
      },
    },
  ],
]);

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

  // Stage 2.5 provider schema endpoint: API metadata is derived from the backend
  // ProviderRegistry so the UI can later stop maintaining a separate schema copy.
  // Presentation-only hints stay centralized here until provider capabilities are
  // promoted into the core provider interface in a future non-UI-breaking phase.
  const providers = notificationProviderRegistry.list().map((provider) => {
    const presentation = providerPresentation.get(provider.type) ?? {
      description: '',
      icon: 'bell',
      capabilities: {
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canTest: false,
        canToggle: false,
      },
    };

    return {
      type: provider.type,
      displayName: provider.name,
      description: presentation.description,
      icon: presentation.icon,
      configSchema: provider.configSchema,
      capabilities: presentation.capabilities,
    };
  });

  return NextResponse.json({ providers }, { headers: noStoreHeaders });
}
