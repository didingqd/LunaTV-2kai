import { NextRequest, NextResponse } from 'next/server';

import type { SystemConfig } from '@/lib/admin.types';
import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { validateUpdateCheckSystemConfigForSave } from '@/lib/system-config-repository';
import { updateCheckPermissionService } from '@/lib/update-check-permission-service';

export const runtime = 'nodejs';

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PUT(request: NextRequest) {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return errorResponse('后端追更配置不支持本地存储', 400);
  }

  const role = await getAdminRoleFromRequest(request);
  if (role !== 'owner') return errorResponse('Forbidden', 403);

  try {
    const body = (await request.json().catch(() => null)) as {
      systemConfig?: Partial<SystemConfig>;
    } | null;
    if (!body?.systemConfig) return errorResponse('Invalid system config', 400);

    const previousConfig = await getConfig();
    const systemConfig = validateUpdateCheckSystemConfigForSave(
      body.systemConfig,
    );
    const nextConfig = {
      ...previousConfig,
      SystemConfig: systemConfig,
    };

    await db.saveAdminConfig(nextConfig);
    clearConfigCache();

    if (
      previousConfig.SystemConfig?.updateCheckBackendEnabled !==
      systemConfig.updateCheckBackendEnabled
    ) {
      await updateCheckPermissionService.onSystemConfigChanged(
        systemConfig.updateCheckBackendEnabled,
      );
    }

    await updateCheckRuntime.handleSystemConfigChanged(
      previousConfig.SystemConfig,
      systemConfig,
    );

    return NextResponse.json(
      { success: true, SystemConfig: systemConfig },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to save update check system config', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to save system config',
      400,
    );
  }
}
