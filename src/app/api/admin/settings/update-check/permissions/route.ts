import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { updateCheckPermissionService } from '@/lib/update-check-permission-service';

export const runtime = 'nodejs';

const permissionSchema = z
  .object({
    userId: z.string().trim().min(1).max(256),
    enabled: z.boolean(),
  })
  .strict();

export async function PUT(request: NextRequest) {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return NextResponse.json(
      { error: '后端追更授权不支持本地存储' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const role = await getAdminRoleFromRequest(request);
  const auth = getAuthInfoFromCookie(request);
  if (!role || !auth?.username) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = permissionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid update check permission', issues: parsed.error.issues },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const config = await getConfig();
  if (
    !config.UserConfig.Users.some(
      (user) => user.username === parsed.data.userId,
    )
  ) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const permission = await updateCheckPermissionService.setPermission(
      parsed.data.userId,
      parsed.data.enabled,
      auth.username,
    );
    return NextResponse.json(
      { success: true, permission },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'OWNER_PERMISSION_IMPLICIT'
    ) {
      return NextResponse.json(
        { error: 'Owner permission follows the system switch' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }
}
