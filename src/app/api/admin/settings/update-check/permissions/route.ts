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

const batchPermissionSchema = z
  .object({
    userIds: z.array(z.string().trim().min(1).max(256)).min(1).max(10000),
    enabled: z.boolean(),
  })
  .strict();

async function authorizeRequest(request: NextRequest) {
  const role = await getAdminRoleFromRequest(request);
  const auth = getAuthInfoFromCookie(request);
  return role && auth?.username ? auth.username : null;
}

export async function PUT(request: NextRequest) {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return NextResponse.json(
      { error: '后端追更授权不支持本地存储' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const operator = await authorizeRequest(request);
  if (!operator) {
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
      operator,
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

export async function POST(request: NextRequest) {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return NextResponse.json(
      { error: '后端追更授权不支持本地存储' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const operator = await authorizeRequest(request);
  if (!operator) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = batchPermissionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid update check permissions',
        issues: parsed.error.issues,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const config = await getConfig();
  if (
    parsed.data.userIds.some(
      (userId) =>
        !config.UserConfig.Users.some((user) => user.username === userId),
    )
  ) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const permissions = await updateCheckPermissionService.setPermissions(
      parsed.data.userIds,
      parsed.data.enabled,
      operator,
    );
    return NextResponse.json(
      { success: true, permissions },
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
