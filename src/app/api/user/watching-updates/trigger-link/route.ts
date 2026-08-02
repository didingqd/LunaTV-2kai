import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { buildUpdateCheckTriggerUrl } from '@/lib/site-url';
import { triggerTokenService } from '@/lib/trigger-token-service';

export const runtime = 'nodejs';

type UserConfigEntry = AdminConfig['UserConfig']['Users'][number];

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.enabled !== undefined, {
    message: 'Missing trigger link update action',
  });

const revealSchema = z
  .object({
    action: z.literal('reveal'),
  })
  .strict();

const noStoreHeaders = { 'Cache-Control': 'private, no-store' };

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function serializeTriggerLink(
  request: NextRequest,
  status: Awaited<ReturnType<typeof triggerTokenService.getStatus>>,
  plainToken?: string,
) {
  const canExpose = canExposeTriggerLink(status);
  const tokenForUrl = canExpose ? (plainToken ?? status.maskedToken) : null;
  return {
    enabled: status.enabled,
    userTriggerEnabled: status.userTriggerEnabled,
    adminTriggerEnabled: status.adminTriggerEnabled,
    effectiveEnabled: status.effectiveEnabled,
    disabledReason: status.disabledReason,
    disabledAt: status.disabledAt,
    disabledSource: status.disabledSource,
    createdAt: status.createdAt,
    rotatedAt: status.rotatedAt,
    expiresAt: status.expiresAt,
    hasToken: status.hasToken,
    tokenConfigured: status.hasToken,
    expired: status.expired,
    tokenId: status.tokenId,
    maskedToken: canExpose ? status.maskedToken : null,
    canRevealToken: canExpose && status.canRevealToken,
    triggerLink: tokenForUrl
      ? buildUpdateCheckTriggerUrl(request, tokenForUrl)
      : null,
    ...(plainToken && canExpose
      ? {
          plainToken,
          fullToken: plainToken,
          fullTriggerLink: buildUpdateCheckTriggerUrl(request, plainToken),
        }
      : {}),
  };
}

function canExposeTriggerLink(
  status: Awaited<ReturnType<typeof triggerTokenService.getStatus>>,
) {
  return status.hasToken && !status.expired;
}

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function authorizeCurrentUser(request: NextRequest) {
  const username = getAuthInfoFromCookie(request)?.username;
  if (!username) return { response: errorResponse('Unauthorized', 401) };

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === username,
  );
  if (!user) return { response: errorResponse('User not found', 404) };

  return { username, user };
}

function canUseTriggerLinkFeature(user: UserConfigEntry) {
  return user.allowTriggerLink === true;
}

function mapServiceError(error: unknown, operation: string) {
  if (error instanceof Error) {
    if (error.message === 'TRIGGER_TOKEN_NOT_FOUND') {
      return errorResponse('Trigger token not found', 404);
    }
    if (error.message === 'USER_NOT_FOUND') {
      return errorResponse('User not found', 404);
    }
    if (error.message === 'TRIGGER_TOKEN_SECRET_UNAVAILABLE') {
      return errorResponse(
        'Trigger token secret is not available; please regenerate it',
        409,
      );
    }
  }

  console.error(`Failed to ${operation} trigger link token`, error);
  return errorResponse(`Failed to ${operation} trigger link token`, 500);
}

export async function GET(request: NextRequest) {
  try {
    const access = await authorizeCurrentUser(request);
    if ('response' in access) return access.response;
    if (!canUseTriggerLinkFeature(access.user)) {
      return errorResponse('Trigger links are not allowed', 403);
    }

    const status = await triggerTokenService.getStatus(access.username);
    return jsonNoStore(serializeTriggerLink(request, status));
  } catch (error) {
    return mapServiceError(error, 'read');
  }
}

export async function POST(request: NextRequest) {
  const access = await authorizeCurrentUser(request);
  if ('response' in access) return access.response;
  if (!canUseTriggerLinkFeature(access.user)) {
    return errorResponse('Trigger links are not allowed', 403);
  }
  return errorResponse('Only administrators can create trigger tokens', 403);
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await authorizeCurrentUser(request);
    if ('response' in access) return access.response;
    if (!canUseTriggerLinkFeature(access.user)) {
      return errorResponse('Trigger links are not allowed', 403);
    }

    const parsed = patchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return errorResponse('Invalid trigger link request', 400);

    const result = await triggerTokenService.setUserEnabled(
      access.username,
      parsed.data.enabled ?? false,
    );

    clearConfigCache();
    return jsonNoStore(serializeTriggerLink(request, result));
  } catch (error) {
    return mapServiceError(error, 'update');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const access = await authorizeCurrentUser(request);
    if ('response' in access) return access.response;
    if (!canUseTriggerLinkFeature(access.user)) {
      return errorResponse('Trigger links are not allowed', 403);
    }

    const parsed = revealSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return errorResponse('Invalid trigger link request', 400);

    const status = await triggerTokenService.getStatus(access.username);
    if (!canExposeTriggerLink(status)) {
      return errorResponse('Trigger link is disabled', 403);
    }

    const result = await triggerTokenService.revealToken(access.username);
    return jsonNoStore(
      serializeTriggerLink(request, result, result.plainToken),
    );
  } catch (error) {
    return mapServiceError(error, 'reveal');
  }
}

export async function DELETE(request: NextRequest) {
  const access = await authorizeCurrentUser(request);
  if ('response' in access) return access.response;
  if (!canUseTriggerLinkFeature(access.user)) {
    return errorResponse('Trigger links are not allowed', 403);
  }
  return errorResponse('Only administrators can delete trigger tokens', 403);
}
