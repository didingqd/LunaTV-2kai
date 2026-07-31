import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { AdminConfig, UserWatchingUpdateConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { updateCheckRuntime } from '@/lib/scheduler/update-check-runtime';
import { resolveUserWatchingUpdateConfig } from '@/lib/user-watching-update-config-resolver';
import {
  userWatchingUpdateConfigService,
  type UserWatchingUpdateConfigField,
} from '@/lib/user-watching-update-config-service';

export const runtime = 'nodejs';

type UserConfigEntry = AdminConfig['UserConfig']['Users'][number];

const patchSchema = z
  .object({
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
  })
  .strict();

const deleteSchema = z
  .object({
    field: z.enum(['cronExpression', 'timezone']).optional(),
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

function getPermission(username: string, user: UserConfigEntry) {
  const owner = username === process.env.USERNAME || user.role === 'owner';
  return {
    enabled: owner || user.updateCheckBackendEnabled === true,
    allowCustomSchedule: user.allowCustomSchedule !== false,
    allowTriggerLink: user.allowTriggerLink === true,
  };
}

function serializeUserConfig(config: UserWatchingUpdateConfig | null) {
  if (!config) return null;
  return {
    cronExpression: config.cronExpression,
    timezone: config.timezone,
    triggerLink: config.triggerLink,
  };
}

function buildConfigResponse(
  username: string,
  user: UserConfigEntry,
  config: AdminConfig,
  userConfig: UserWatchingUpdateConfig | null,
) {
  const permission = getPermission(username, user);
  const resolved = resolveUserWatchingUpdateConfig({
    username,
    userUpdateCheckBackendEnabled: permission.enabled,
    allowCustomSchedule: permission.allowCustomSchedule,
    allowTriggerLink: permission.allowTriggerLink,
    systemConfig: config.SystemConfig,
    userConfig,
  });

  return {
    permission,
    userConfig: serializeUserConfig(userConfig),
    effectiveConfig: {
      enabled: resolved.enabled,
      cronExpression: resolved.cronExpression,
      timezone: resolved.timezone,
    },
    sources: resolved.source,
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

  return { config, user, username };
}

function mapServiceError(error: unknown, operation: string) {
  if (error instanceof Error) {
    if (error.message === 'USER_NOT_FOUND') {
      return errorResponse('User not found', 404);
    }
    if (
      error.message === 'INVALID_CRON_EXPRESSION' ||
      error.message === 'INVALID_TIMEZONE' ||
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

async function reloadUserResponse(username: string) {
  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === username,
  );
  if (!user) return null;
  const userConfig =
    await userWatchingUpdateConfigService.getUserWatchingUpdateConfig(username);
  return buildConfigResponse(username, user, config, userConfig);
}

export async function GET(request: NextRequest) {
  try {
    const access = await authorizeCurrentUser(request);
    if ('response' in access) return access.response;

    const userConfig =
      await userWatchingUpdateConfigService.getUserWatchingUpdateConfig(
        access.username,
      );
    return jsonNoStore(
      buildConfigResponse(
        access.username,
        access.user,
        access.config,
        userConfig,
      ),
    );
  } catch (error) {
    return mapServiceError(error, 'read');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await authorizeCurrentUser(request);
    if ('response' in access) return access.response;

    if (access.user.allowCustomSchedule === false) {
      return errorResponse('Custom schedule is not allowed', 403);
    }

    const parsed = patchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return errorResponse('Invalid user watching update config', 400);
    }

    if (Object.keys(parsed.data).length > 0) {
      await userWatchingUpdateConfigService.updateUserWatchingUpdateConfig(
        access.username,
        parsed.data,
      );
      clearConfigCache();
      await updateCheckRuntime.reconcileUser(access.username);
    }

    const body = await reloadUserResponse(access.username);
    if (!body) return errorResponse('User not found', 404);
    return jsonNoStore(body);
  } catch (error) {
    return mapServiceError(error, 'update');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await authorizeCurrentUser(request);
    if ('response' in access) return access.response;

    if (access.user.allowCustomSchedule === false) {
      return errorResponse('Custom schedule is not allowed', 403);
    }

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

    const fields: UserWatchingUpdateConfigField[] = parsed.data.field
      ? [parsed.data.field]
      : ['cronExpression', 'timezone'];
    for (const field of fields) {
      await userWatchingUpdateConfigService.clearUserWatchingUpdateConfigField(
        access.username,
        field,
      );
    }
    clearConfigCache();
    await updateCheckRuntime.reconcileUser(access.username);

    const response = await reloadUserResponse(access.username);
    if (!response) return errorResponse('User not found', 404);
    return jsonNoStore(response);
  } catch (error) {
    return mapServiceError(error, 'clear');
  }
}
