import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { AdminConfig } from '@/lib/admin.types';
import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { resolveUserWatchingUpdateConfig } from '@/lib/user-watching-update-config-resolver';
import {
  userWatchingUpdateConfigService,
  type UserWatchingUpdateConfigField,
} from '@/lib/user-watching-update-config-service';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ username: string }>;
};

type AdminUser = AdminConfig['UserConfig']['Users'][number];

const patchSchema = z
  .object({
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    logRetentionCount: z.number().optional(),
  })
  .strict();

const deleteSchema = z
  .object({
    field: z
      .enum(['cronExpression', 'timezone', 'logRetentionCount'])
      .optional(),
  })
  .strict();

const noStoreHeaders = { 'Cache-Control': 'private, no-store' };

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function authorizeTarget(request: NextRequest, context: RouteContext) {
  const role = await getAdminRoleFromRequest(request);
  if (!role) return { response: errorResponse('Forbidden', 403) };

  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return {
      response: errorResponse(
        'User watching update config does not support local storage',
        400,
      ),
    };
  }

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

  return { config, user, username };
}

function buildConfigResponse(
  username: string,
  user: AdminUser,
  config: AdminConfig,
  override: Awaited<
    ReturnType<
      typeof userWatchingUpdateConfigService.getUserWatchingUpdateConfig
    >
  >,
) {
  const permission = user.updateCheckBackendEnabled === true;
  const resolved = resolveUserWatchingUpdateConfig({
    username,
    userUpdateCheckBackendEnabled: permission,
    systemConfig: config.SystemConfig,
    userConfig: override,
  });
  const { source: sources, ...effective } = resolved;

  return {
    username,
    permission,
    override,
    effective,
    sources,
  };
}

function mapServiceError(error: unknown, operation: string) {
  if (error instanceof Error) {
    if (error.message === 'USER_NOT_FOUND') {
      return errorResponse('User not found', 404);
    }
    if (
      error.message === 'INVALID_CRON_EXPRESSION' ||
      error.message === 'INVALID_TIMEZONE' ||
      error.message === 'INVALID_LOG_RETENTION_COUNT' ||
      error.message === 'UNSUPPORTED_USER_WATCHING_UPDATE_CONFIG_FIELD'
    ) {
      return errorResponse('Invalid user watching update config', 400);
    }
  }

  console.error(`Failed to ${operation} user watching update config`, error);
  return errorResponse(
    `Failed to ${operation} user watching update config`,
    500,
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const access = await authorizeTarget(request, context);
    if ('response' in access) return access.response;

    const override =
      await userWatchingUpdateConfigService.getUserWatchingUpdateConfig(
        access.username,
      );
    return NextResponse.json(
      buildConfigResponse(
        access.username,
        access.user,
        access.config,
        override,
      ),
      { headers: noStoreHeaders },
    );
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
    if (!parsed.success) {
      return errorResponse('Invalid user watching update config', 400);
    }

    const override =
      await userWatchingUpdateConfigService.updateUserWatchingUpdateConfig(
        access.username,
        parsed.data,
      );
    clearConfigCache();
    await updateCheckRuntime.reconcileUser(access.username);
    return NextResponse.json(
      buildConfigResponse(
        access.username,
        access.user,
        access.config,
        override,
      ),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return mapServiceError(error, 'update');
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const access = await authorizeTarget(request, context);
    if ('response' in access) return access.response;

    const body = await request.text();
    let value: unknown = {};
    if (body.trim()) {
      try {
        value = JSON.parse(body);
      } catch {
        return errorResponse('Invalid user watching update config', 400);
      }
    }
    const parsed = deleteSchema.safeParse(value);
    if (!parsed.success) {
      return errorResponse('Invalid user watching update config', 400);
    }

    let override = null;
    if (parsed.data.field) {
      override =
        await userWatchingUpdateConfigService.clearUserWatchingUpdateConfigField(
          access.username,
          parsed.data.field as UserWatchingUpdateConfigField,
        );
    } else {
      await userWatchingUpdateConfigService.clearUserWatchingUpdateConfig(
        access.username,
      );
    }

    clearConfigCache();
    await updateCheckRuntime.reconcileUser(access.username);

    return NextResponse.json(
      buildConfigResponse(
        access.username,
        access.user,
        access.config,
        override,
      ),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return mapServiceError(error, 'clear');
  }
}
