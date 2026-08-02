import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { triggerTokenService } from '@/lib/trigger-token-service';

export const runtime = 'nodejs';

type UserConfigEntry = AdminConfig['UserConfig']['Users'][number];

const postSchema = z
  .object({
    expiresAt: z.number().int().positive().nullable().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    action: z.enum(['rotate', 'expire']).optional(),
    enabled: z.boolean().optional(),
    expiresAt: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.action !== undefined ||
      value.enabled !== undefined ||
      Object.prototype.hasOwnProperty.call(value, 'expiresAt'),
    { message: 'Missing trigger link update action' },
  );

const revealSchema = z
  .object({
    action: z.literal('reveal'),
  })
  .strict();

const noStoreHeaders = { 'Cache-Control': 'private, no-store' };

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function triggerUrlFromToken(request: NextRequest, token: string | null) {
  if (!token) return null;
  const url = new URL('/api/update-check-trigger', request.url);
  url.searchParams.set('token', token);
  return url.toString();
}

function serializeTriggerLink(
  request: NextRequest,
  status: Awaited<ReturnType<typeof triggerTokenService.getStatus>>,
  plainToken?: string,
) {
  const tokenForUrl = plainToken ?? status.maskedToken;
  return {
    enabled: status.enabled,
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
    maskedToken: status.maskedToken,
    canRevealToken: status.canRevealToken,
    triggerLink: triggerUrlFromToken(request, tokenForUrl),
    ...(plainToken
      ? {
          plainToken,
          fullToken: plainToken,
          fullTriggerLink: triggerUrlFromToken(request, plainToken),
        }
      : {}),
  };
}

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function getPermission(user: UserConfigEntry) {
  return {
    allowTriggerLink: user.allowTriggerLink === true,
  };
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

async function requireTriggerLinkPermission(request: NextRequest) {
  const access = await authorizeCurrentUser(request);
  if ('response' in access) return access;

  if (!getPermission(access.user).allowTriggerLink) {
    return { response: errorResponse('Trigger Link is not allowed', 403) };
  }

  return access;
}

async function forbidSystemDisabledMutation(username: string) {
  const status = await triggerTokenService.getStatus(username);
  if (
    status.hasToken &&
    !status.enabled &&
    status.disabledSource === 'system'
  ) {
    return {
      response: errorResponse('Trigger Link disabled by system', 403),
    };
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireTriggerLinkPermission(request);
    if ('response' in access) return access.response;

    const status = await triggerTokenService.getStatus(access.username);
    return jsonNoStore(serializeTriggerLink(request, status));
  } catch (error) {
    return mapServiceError(error, 'read');
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireTriggerLinkPermission(request);
    if ('response' in access) return access.response;
    const blocked = await forbidSystemDisabledMutation(access.username);
    if (blocked) return blocked.response;

    const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success)
      return errorResponse('Invalid trigger link request', 400);

    const result = await triggerTokenService.createToken(access.username, {
      expiresAt: parsed.data.expiresAt,
    });
    clearConfigCache();
    return jsonNoStore(serializeTriggerLink(request, result));
  } catch (error) {
    return mapServiceError(error, 'create');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireTriggerLinkPermission(request);
    if ('response' in access) return access.response;
    const blocked = await forbidSystemDisabledMutation(access.username);
    if (blocked) return blocked.response;

    const parsed = patchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return errorResponse('Invalid trigger link request', 400);

    let result;
    if (parsed.data.action === 'rotate') {
      result = await triggerTokenService.rotateToken(access.username);
    } else if (parsed.data.action === 'expire') {
      result = await triggerTokenService.expireToken(access.username);
    } else if (parsed.data.enabled !== undefined) {
      result = await triggerTokenService.setEnabled(
        access.username,
        parsed.data.enabled,
      );
    } else {
      result = await triggerTokenService.setExpiresAt(
        access.username,
        parsed.data.expiresAt ?? null,
      );
    }

    clearConfigCache();
    return jsonNoStore(serializeTriggerLink(request, result));
  } catch (error) {
    return mapServiceError(error, 'update');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const access = await requireTriggerLinkPermission(request);
    if ('response' in access) return access.response;

    const parsed = revealSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return errorResponse('Invalid trigger link request', 400);

    const result = await triggerTokenService.revealToken(access.username);
    return jsonNoStore(
      serializeTriggerLink(request, result, result.plainToken),
    );
  } catch (error) {
    return mapServiceError(error, 'reveal');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await requireTriggerLinkPermission(request);
    if ('response' in access) return access.response;
    const blocked = await forbidSystemDisabledMutation(access.username);
    if (blocked) return blocked.response;

    const body = await request.text();
    if (body.trim()) {
      const parsed = z.object({}).strict().safeParse(JSON.parse(body));
      if (!parsed.success)
        return errorResponse('Invalid trigger link request', 400);
    }

    const result = await triggerTokenService.deleteToken(access.username);
    clearConfigCache();
    return jsonNoStore(serializeTriggerLink(request, result));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errorResponse('Invalid trigger link request', 400);
    }
    return mapServiceError(error, 'delete');
  }
}
