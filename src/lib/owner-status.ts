import type { AdminConfig } from '@/lib/admin.types';
import { getLegacyOwnerUsername } from '@/lib/owner-resolver';

export type OwnerStatusSource = 'env' | 'database' | 'config';

export interface OwnerStatusUser {
  username: string;
  sources: OwnerStatusSource[];
  effective: boolean;
  banned?: boolean;
}

export interface OwnerStatusDatabaseUser {
  username: string;
  role?: 'owner' | 'admin' | 'user' | null;
  banned?: boolean | null;
}

export interface OwnerStatusInput {
  envUsername?: string | null;
  databaseUsers?: OwnerStatusDatabaseUser[] | null;
  adminConfig?: AdminConfig | null;
}

export interface OwnerStatus {
  hasOwner: boolean;
  sources: OwnerStatusSource[];
  ownerUsers: OwnerStatusUser[];
}

function hasOwnKey<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveEnvUsername(input: OwnerStatusInput): string | undefined {
  if (hasOwnKey(input, 'envUsername')) {
    return input.envUsername ?? undefined;
  }
  return getLegacyOwnerUsername();
}

function recordOwner(
  owners: Map<string, OwnerStatusUser>,
  username: string,
  source: OwnerStatusSource,
  effective: boolean,
  banned?: boolean,
) {
  const existing = owners.get(username);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    existing.effective = existing.effective || effective;
    existing.banned = existing.banned || banned;
    return;
  }

  owners.set(username, {
    username,
    sources: [source],
    effective,
    ...(banned !== undefined ? { banned } : {}),
  });
}

export function getOwnerStatus(input: OwnerStatusInput = {}): OwnerStatus {
  const owners = new Map<string, OwnerStatusUser>();
  const envUsername = resolveEnvUsername(input);

  if (envUsername) {
    recordOwner(owners, envUsername, 'env', true);
  }

  for (const user of input.databaseUsers ?? []) {
    if (user.role === 'owner') {
      recordOwner(
        owners,
        user.username,
        'database',
        false,
        user.banned ?? undefined,
      );
    }
  }

  for (const user of input.adminConfig?.UserConfig?.Users ?? []) {
    if (user.role === 'owner') {
      recordOwner(owners, user.username, 'config', false, user.banned);
    }
  }

  const ownerUsers = Array.from(owners.values());
  const sources = Array.from(
    new Set(ownerUsers.flatMap((owner) => owner.sources)),
  );

  return {
    hasOwner: ownerUsers.some((owner) => owner.effective),
    sources,
    ownerUsers,
  };
}

export function hasEffectiveOwner(input: OwnerStatusInput = {}): boolean {
  return getOwnerStatus(input).hasOwner;
}

