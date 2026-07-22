import { NextRequest } from 'next/server';
import { z } from 'zod';

import { updateCheckService } from '@/lib/update-check-service';
import {
  internalError,
  noStoreJson,
  parseJsonBody,
  requireWatchingFollowUser,
} from '../route-utils';

export const runtime = 'nodejs';

const checkSchema = z
  .object({
    followIds: z.array(z.string().trim().min(1).max(2048)).max(200).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireWatchingFollowUser(request);
    if (auth.response) return auth.response;

    const parsed = checkSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      return noStoreJson(
        { error: 'Invalid update check request', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const batch = await updateCheckService.checkUser(
      auth.username,
      parsed.data.followIds,
    );
    return noStoreJson({
      userId: auth.username,
      checkedAt: Date.now(),
      ...batch,
    });
  } catch (error) {
    return internalError(error);
  }
}
