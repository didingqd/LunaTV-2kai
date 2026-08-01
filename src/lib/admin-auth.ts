import { NextRequest } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { isOwner, resolveUserRole } from '@/lib/owner-resolver';

export type AdminRole = 'owner' | 'admin';

async function resolveRoleFromConfig(
  config: AdminConfig,
  username: string
): Promise<AdminRole | null> {
  const role = resolveUserRole(username, config);
  return role === 'owner' || role === 'admin' ? role : null;
}

export async function getAdminRoleFromRequest(
  request: NextRequest
): Promise<AdminRole | null> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo) {
    return null;
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (storageType === 'localstorage') {
    const password = authInfo.password;
    if (password && password === process.env.PASSWORD) {
      return 'owner';
    }
    return null;
  }

  const username = authInfo.username;
  if (!username) {
    return null;
  }

  if (isOwner(username)) {
    return 'owner';
  }

  const config = await getConfig();
  return resolveRoleFromConfig(config, username);
}

export async function ensureAdmin(request: NextRequest): Promise<AdminRole> {
  const role = await getAdminRoleFromRequest(request);
  if (!role) {
    throw new Error('UNAUTHORIZED');
  }
  return role;
}
