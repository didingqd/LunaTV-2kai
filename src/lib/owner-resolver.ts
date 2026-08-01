import type { AdminConfig } from '@/lib/admin.types';

export type OwnerSource = 'env' | 'none';
export type ResolvedUserRole = 'owner' | 'admin' | 'user' | null;

type UserConfigEntry = AdminConfig['UserConfig']['Users'][number];

export function getLegacyOwnerUsername(
  fallback?: string,
): string | undefined {
  if (fallback === undefined) return process.env.USERNAME;
  return process.env.USERNAME || fallback;
}

export function isLegacyEnvOwner(username?: string | null): boolean {
  if (username === undefined || username === null) return false;
  return username === getLegacyOwnerUsername();
}

export function getOwnerSource(username?: string | null): OwnerSource {
  return isLegacyEnvOwner(username) ? 'env' : 'none';
}

export function isOwner(username?: string | null): boolean {
  return getOwnerSource(username) === 'env';
}

function findConfiguredUser(
  username: string,
  config?: AdminConfig | null,
): UserConfigEntry | undefined {
  return config?.UserConfig?.Users?.find((user) => user.username === username);
}

export function resolveUserRole(
  username?: string | null,
  config?: AdminConfig | null,
): ResolvedUserRole {
  if (username === undefined || username === null) return null;
  if (isOwner(username)) return 'owner';

  const user = findConfiguredUser(username, config);
  if (!user) return null;
  if (user.banned) return null;
  if (user.role === 'admin') return 'admin';

  return 'user';
}
