import { NextRequest, NextResponse } from 'next/server';

import {
  noStoreJson,
  requireWatchingFollowUser,
} from '@/app/api/watching-follows/route-utils';
import type { AdminConfig } from '@/lib/admin.types';
import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getUserWatchCompletionThresholdFromConfig } from '@/lib/watch-completion-threshold-preference';
import { sanitizeWatchCompletionThreshold } from '@/lib/watching-update-calculation';

type UserConfigEntry = AdminConfig['UserConfig']['Users'][number];

function findUser(config: AdminConfig, username: string) {
  return config.UserConfig.Users.find((user) => user.username === username);
}

function ensureUser(config: AdminConfig, username: string): UserConfigEntry {
  const user = findUser(config, username);
  if (user) return user;

  const newUser: UserConfigEntry = {
    username,
    role: username === process.env.USERNAME ? 'owner' : 'user',
    banned: false,
  };
  config.UserConfig.Users.push(newUser);
  return newUser;
}

export async function GET(request: NextRequest) {
  const auth = await requireWatchingFollowUser(request);
  if (auth.response) return auth.response;

  const config = await getConfig();
  return noStoreJson({
    watchCompletionThreshold: getUserWatchCompletionThresholdFromConfig(
      config,
      auth.username,
    ),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireWatchingFollowUser(request);
  if (auth.response) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const threshold = sanitizeWatchCompletionThreshold(
    (payload as { watchCompletionThreshold?: unknown })
      ?.watchCompletionThreshold,
  );
  const config = await getConfig();
  const user = ensureUser(config, auth.username);
  user.watchCompletionThreshold = threshold;

  await db.saveAdminConfig(config);
  clearConfigCache();

  return noStoreJson({ watchCompletionThreshold: threshold });
}
