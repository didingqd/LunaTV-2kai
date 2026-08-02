import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { AdminConfig } from '@/lib/admin.types';
import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { DEFAULT_TRIGGER_LINK_ACCESS_CONTROL } from '@/lib/trigger-link-access-control-service';
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
    allowCustomSchedule: z.boolean().optional(),
    allowTriggerLink: z.boolean().optional(),
    triggerLinkAccessControl: z
      .object({
        enabled: z.boolean().optional(),
        ipLimit: z
          .object({
            enabled: z.boolean().optional(),
            windowMinutes: z.number().int().positive().optional(),
            maxAttempts: z.number().int().positive().optional(),
            blockMinutes: z.number().int().positive().optional(),
          })
          .optional(),
        userLimit: z
          .object({
            enabled: z.boolean().optional(),
            windowMinutes: z.number().int().positive().optional(),
            maxAttempts: z.number().int().positive().optional(),
          })
          .optional(),
        autoDisable: z
          .object({
            enabled: z.boolean().optional(),
            violationThreshold: z.number().int().positive().optional(),
            violationWindowMinutes: z.number().int().positive().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .strict();

const deleteSchema = z
  .object({
    field: z.enum(['cronExpression', 'timezone']).optional(),
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
  const operator = getAuthInfoFromCookie(request)?.username ?? role;

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

  return { config, operator, user, username };
}

function buildConfigResponse(
  username: string,
  user: AdminUser,
  config: AdminConfig,
  userConfig: Awaited<
    ReturnType<
      typeof userWatchingUpdateConfigService.getUserWatchingUpdateConfig
    >
  >,
) {
  const permissionEnabled = user.updateCheckBackendEnabled === true;
  const allowCustomSchedule = user.allowCustomSchedule !== false;
  const allowTriggerLink = user.allowTriggerLink === true;
  const resolved = resolveUserWatchingUpdateConfig({
    username,
    userUpdateCheckBackendEnabled: permissionEnabled,
    allowCustomSchedule,
    allowTriggerLink,
    systemConfig: config.SystemConfig,
    userConfig,
  });
  const { source: sources } = resolved;

  return {
    username,
    permission: {
      enabled: permissionEnabled,
      allowCustomSchedule,
      allowTriggerLink,
    },
    userConfig: userConfig
      ? {
          cronExpression: userConfig.cronExpression,
          timezone: userConfig.timezone,
        }
      : null,
    triggerLinkAccessControl:
      userConfig?.triggerLinkAccessControl ??
      DEFAULT_TRIGGER_LINK_ACCESS_CONTROL,
    effective: {
      enabled: resolved.enabled,
      cronExpression: resolved.cronExpression,
      timezone: resolved.timezone,
    },
    sources,
    audit: {
      updatedAt:
        userConfig?.updatedAt ?? user.updateCheckPermissionUpdatedAt ?? null,
      operator:
        userConfig?.operator ?? user.updateCheckPermissionOperator ?? null,
    },
  };
}

async function updateUserAbilityPermissions(
  username: string,
  operator: string,
  patch: Pick<
    z.infer<typeof patchSchema>,
    'allowCustomSchedule' | 'allowTriggerLink'
  >,
) {
  const hasAllowCustomSchedule = Object.prototype.hasOwnProperty.call(
    patch,
    'allowCustomSchedule',
  );
  const hasAllowTriggerLink = Object.prototype.hasOwnProperty.call(
    patch,
    'allowTriggerLink',
  );
  if (!hasAllowCustomSchedule && !hasAllowTriggerLink) return false;

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === username,
  );
  if (!user) throw new Error('USER_NOT_FOUND');

  if (hasAllowCustomSchedule) {
    user.allowCustomSchedule = patch.allowCustomSchedule;
  }
  if (hasAllowTriggerLink) {
    user.allowTriggerLink = patch.allowTriggerLink;
  }
  user.updateCheckPermissionUpdatedAt = Date.now();
  user.updateCheckPermissionOperator = operator;

  await db.saveAdminConfig(config);
  clearConfigCache();
  return true;
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
      error.message === 'INVALID_TRIGGER_LINK_ACCESS_CONTROL' ||
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

    const userConfig =
      await userWatchingUpdateConfigService.getUserWatchingUpdateConfig(
        access.username,
      );
    return NextResponse.json(
      buildConfigResponse(
        access.username,
        access.user,
        access.config,
        userConfig,
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

    await updateUserAbilityPermissions(
      access.username,
      access.operator,
      parsed.data,
    );

    const configPatch = {
      ...(parsed.data.cronExpression !== undefined
        ? { cronExpression: parsed.data.cronExpression }
        : {}),
      ...(parsed.data.timezone !== undefined
        ? { timezone: parsed.data.timezone }
        : {}),
      ...(parsed.data.triggerLinkAccessControl !== undefined
        ? { triggerLinkAccessControl: parsed.data.triggerLinkAccessControl }
        : {}),
    };
    const shouldUpdateUserConfig = Object.keys(configPatch).length > 0;
    if (shouldUpdateUserConfig) {
      await userWatchingUpdateConfigService.updateUserWatchingUpdateConfig(
        access.username,
        configPatch,
      );
      clearConfigCache();
      if (
        parsed.data.cronExpression !== undefined ||
        parsed.data.timezone !== undefined
      ) {
        await updateCheckRuntime.reconcileUser(access.username);
      }
    }

    const latestConfig = await getConfig();
    const latestUser = latestConfig.UserConfig.Users.find(
      (candidate) => candidate.username === access.username,
    );
    if (!latestUser) return errorResponse('User not found', 404);
    const userConfig =
      await userWatchingUpdateConfigService.getUserWatchingUpdateConfig(
        access.username,
      );
    return NextResponse.json(
      buildConfigResponse(
        access.username,
        latestUser,
        latestConfig,
        userConfig,
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
