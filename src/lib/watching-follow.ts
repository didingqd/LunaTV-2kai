import { z } from 'zod';

import {
  buildContentIdentityKey,
  compareContentIdentity,
} from './content-identity';
import type { WatchingFollow } from './types';

const requiredText = z.string().trim().min(1).max(512);
const metadataText = z.string().max(2048);
const timestamp = z.number().int().nonnegative();

export const watchingFollowCreateSchema = z
  .object({
    source: requiredText,
    id: requiredText,
    title: requiredText,
    cover: metadataText,
    year: z.string().max(32),
    type: z.string().max(64),
    originalEpisodes: z.number().int().nonnegative(),
    createdAt: timestamp.optional(),
    updatedAt: timestamp.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const watchingFollowUpdateSchema = z
  .object({
    title: requiredText.optional(),
    cover: metadataText.optional(),
    year: z.string().max(32).optional(),
    type: z.string().max(64).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one updatable field is required',
  });

export type WatchingFollowCreateInput = z.infer<
  typeof watchingFollowCreateSchema
>;
export type WatchingFollowUpdateInput = z.infer<
  typeof watchingFollowUpdateSchema
>;

export function watchingFollowStorageKey(source: string, id: string): string {
  return buildContentIdentityKey(source, id);
}

export function migrateStoredWatchingFollow(
  value: unknown,
): WatchingFollow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const {
    original_episodes: originalEpisodesLegacy,
    created_at: createdAtLegacy,
    updated_at: updatedAtLegacy,
    ...rest
  } = raw;
  const normalized = {
    ...rest,
    type: raw.type ?? '',
    originalEpisodes: raw.originalEpisodes ?? originalEpisodesLegacy,
    createdAt: raw.createdAt ?? createdAtLegacy,
    updatedAt: raw.updatedAt ?? updatedAtLegacy,
  };
  const parsed = watchingFollowCreateSchema.safeParse(normalized);
  return parsed.success ? createWatchingFollow(parsed.data) : null;
}

export function assertWatchingFollowCanBeStored(
  existing: WatchingFollow | null,
  source: string,
  id: string,
  follow: WatchingFollow,
): void {
  if (!compareContentIdentity(follow, { source, id })) {
    throw new Error('WatchingFollow identity does not match its storage key');
  }

  if (existing && existing.originalEpisodes !== follow.originalEpisodes) {
    throw new Error('WatchingFollow.originalEpisodes is immutable');
  }
}

export function createWatchingFollow(
  input: WatchingFollowCreateInput,
  now = Date.now(),
): WatchingFollow {
  return {
    source: input.source,
    id: input.id,
    title: input.title,
    cover: input.cover,
    year: input.year,
    type: input.type,
    originalEpisodes: input.originalEpisodes,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    enabled: input.enabled ?? true,
  };
}

export function updateWatchingFollow(
  existing: WatchingFollow,
  input: WatchingFollowUpdateInput,
  now = Date.now(),
): WatchingFollow {
  return {
    ...existing,
    title: input.title ?? existing.title,
    cover: input.cover ?? existing.cover,
    year: input.year ?? existing.year,
    type: input.type ?? existing.type,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: now,
    originalEpisodes: existing.originalEpisodes,
  };
}
