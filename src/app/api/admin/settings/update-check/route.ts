import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
import { systemConfigRepository } from '@/lib/system-config-repository';
import { updateCheckPermissionService } from '@/lib/update-check-permission-service';
import { updateCheckService } from '@/lib/update-check-service';

export const runtime = 'nodejs';

const updateCheckConfigSchema = z
  .object({
    enabled: z.boolean(),
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

  const config = await systemConfigRepository.getUpdateCheckConfig();
  const adminConfig = await getConfig();
  const users = await updateCheckPermissionService.listUsers(
    adminConfig.UserConfig.Users.map((user) => user.username),
  );
  return noStoreJson({
    enabled: config.updateCheckBackendEnabled,
    batchSize: config.updateCheckBatchSize,
    maxUsers: config.updateCheckMaxUsers,
    maxFollowPerUser: config.updateCheckMaxFollowPerUser,
    users,
  });
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
    updateCheckBatchSize: parsed.data.batchSize,
    updateCheckMaxUsers: parsed.data.maxUsers,
    updateCheckMaxFollowPerUser: parsed.data.maxFollowPerUser,
  });
  if (saved.updateCheckBackendEnabled && process.env.USERNAME) {
    await updateCheckService.onUserPermissionEnabled(process.env.USERNAME);
  }
  return noStoreJson({
    enabled: saved.updateCheckBackendEnabled,
    batchSize: saved.updateCheckBatchSize,
    maxUsers: saved.updateCheckMaxUsers,
    maxFollowPerUser: saved.updateCheckMaxFollowPerUser,
  });
}
