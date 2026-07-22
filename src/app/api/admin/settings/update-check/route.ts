import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import type { SystemConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import {
  systemConfigRepository,
  UPDATE_CHECK_CRON_INTERVAL_OPTIONS,
} from '@/lib/system-config-repository';
import { updateCheckPermissionService } from '@/lib/update-check-permission-service';

export const runtime = 'nodejs';

const updateCheckConfigSchema = z
  .object({
    enabled: z.boolean(),
    updateCheckCronInterval: z
      .number()
      .int()
      .refine((value) =>
        UPDATE_CHECK_CRON_INTERVAL_OPTIONS.includes(
          value as (typeof UPDATE_CHECK_CRON_INTERVAL_OPTIONS)[number],
        ),
      ),
    batchSize: z.number().int().min(1).max(500),
    maxUsers: z.number().int().min(1).max(10000),
    maxFollowPerUser: z.number().int().min(1).max(1000),
  })
  .strict();

function noStoreJson(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

async function requireAdmin(request: NextRequest) {
  return (await getAdminRoleFromRequest(request)) !== null;
}

function rejectsLocalStorage() {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  );
}

async function getSettingsResponse(config?: SystemConfig) {
  const current =
    config ?? (await systemConfigRepository.getUpdateCheckConfig());
  const adminConfig = await getConfig();
  const users = await updateCheckPermissionService.listUsers(
    adminConfig.UserConfig.Users.map((user) => user.username),
    current,
  );
  return {
    enabled: current.updateCheckBackendEnabled,
    updateCheckCronInterval: current.updateCheckCronInterval,
    batchSize: current.updateCheckBatchSize,
    maxUsers: current.updateCheckMaxUsers,
    maxFollowPerUser: current.updateCheckMaxFollowPerUser,
    users,
  };
}

export async function GET(request: NextRequest) {
  if (rejectsLocalStorage()) {
    return noStoreJson(
      { error: '后端追更配置不支持本地存储' },
      { status: 400 },
    );
  }
  if (!(await requireAdmin(request))) {
    return noStoreJson({ error: 'Unauthorized' }, { status: 403 });
  }

  return noStoreJson(await getSettingsResponse());
}

export async function PUT(request: NextRequest) {
  if (rejectsLocalStorage()) {
    return noStoreJson(
      { error: '后端追更配置不支持本地存储' },
      { status: 400 },
    );
  }
  if (!(await requireAdmin(request))) {
    return noStoreJson({ error: 'Unauthorized' }, { status: 403 });
  }

  const parsed = updateCheckConfigSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return noStoreJson(
      { error: 'Invalid update check config', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const saved = await systemConfigRepository.saveUpdateCheckConfig({
    updateCheckBackendEnabled: parsed.data.enabled,
    updateCheckCronInterval: parsed.data.updateCheckCronInterval,
    updateCheckBatchSize: parsed.data.batchSize,
    updateCheckMaxUsers: parsed.data.maxUsers,
    updateCheckMaxFollowPerUser: parsed.data.maxFollowPerUser,
  });
  await updateCheckPermissionService.onSystemConfigChanged(
    saved.updateCheckBackendEnabled,
  );
  return noStoreJson(await getSettingsResponse(saved));
}
