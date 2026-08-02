import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { AdminConfig } from '@/lib/admin.types';
import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { triggerLinkAccessControlService } from '@/lib/trigger-link-access-control-service';
import { triggerTokenService } from '@/lib/trigger-token-service';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ username: string }>;
};

type AdminUser = AdminConfig['UserConfig']['Users'][number];

const patchSchema = z
  .object({
    action: z.enum(['generate']).optional(),
    enabled: z.boolean().optional(),
    token: z.string().trim().min(1).max(512).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.action !== undefined ||
      value.enabled !== undefined ||
      value.token !== undefined,
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

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
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
          fullToken: plainToken,
          fullTriggerLink: triggerUrlFromToken(request, plainToken),
        }
      : {}),
  };
}

async function authorizeTarget(request: NextRequest, context: RouteContext) {
  const role = await getAdminRoleFromRequest(request);
  if (!role) return { response: errorResponse('Forbidden', 403) };
  const operator = getAuthInfoFromCookie(request)?.username ?? role;

  const { username } = await context.params;
  if (!username || username.length > 256) {
    return { response: errorResponse('Invalid username', 400) };
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === username,
  );
  if (!user) return { response: errorResponse('User not found', 404) };
  if (role === 'admin' && user.role !== 'user') {
    return { response: errorResponse('Forbidden', 403) };
  }

  return { config, operator, user, username };
}

function buildPermission(user: AdminUser) {
  return {
    allowTriggerLink: user.allowTriggerLink === true,
  };
}

function mapServiceError(error: unknown, operation: string) {
  if (error instanceof Error) {
    if (error.message === 'TRIGGER_TOKEN_NOT_FOUND') {
      return errorResponse('Trigger token not found', 404);
    }
    if (error.message === 'TRIGGER_TOKEN_INVALID') {
      return errorResponse('Invalid trigger token', 400);
    }
    if (error.message === 'TRIGGER_TOKEN_SECRET_UNAVAILABLE') {
      return errorResponse(
        'Trigger token secret is not available; please regenerate it',
        409,
      );
    }
    if (error.message === 'TRIGGER_TOKEN_ID_COLLISION') {
      return errorResponse('Trigger token id already exists', 409);
    }
  }

  console.error(`Failed to ${operation} admin trigger link token`, error);
  return errorResponse(`Failed to ${operation} trigger link token`, 500);
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const access = await authorizeTarget(request, context);
    if ('response' in access) return access.response;

    const status = await triggerTokenService.getStatus(access.username);
    return jsonNoStore({
      username: access.username,
      permission: buildPermission(access.user),
      triggerLink: serializeTriggerLink(request, status),
    });
  } catch (error) {
    return mapServiceError(error, 'read');
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const access = await authorizeTarget(request, context);
    if ('response' in access) return access.response;

    const parsed = patchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return errorResponse('Invalid trigger link request', 400);

    let status;
    if (parsed.data.token !== undefined) {
      status = await triggerTokenService.setToken(
        access.username,
        parsed.data.token,
        {
          enabled: parsed.data.enabled,
        },
      );
    } else if (parsed.data.action === 'generate') {
      status = await triggerTokenService.createToken(access.username);
      if (parsed.data.enabled === false) {
        status = await triggerTokenService.setEnabled(access.username, false);
      }
    } else {
      status = await triggerTokenService.setEnabled(
        access.username,
        parsed.data.enabled ?? false,
      );
      if (parsed.data.enabled === true) {
        await triggerLinkAccessControlService.clearUserState(access.username);
      }
    }

    clearConfigCache();
    return jsonNoStore({
      username: access.username,
      permission: buildPermission(access.user),
      triggerLink: serializeTriggerLink(request, status),
      audit: {
        operator: access.operator,
        tokenId: status.tokenId,
        maskedToken: status.maskedToken,
      },
    });
  } catch (error) {
    return mapServiceError(error, 'update');
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const access = await authorizeTarget(request, context);
    if ('response' in access) return access.response;

    const parsed = revealSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return errorResponse('Invalid trigger link request', 400);

    const result = await triggerTokenService.revealToken(access.username);
    return jsonNoStore({
      username: access.username,
      permission: buildPermission(access.user),
      triggerLink: serializeTriggerLink(request, result, result.plainToken),
    });
  } catch (error) {
    return mapServiceError(error, 'reveal');
  }
}
