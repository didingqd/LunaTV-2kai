import { NextRequest } from 'next/server';

import { updateCheckService } from '@/lib/update-check-service';
import {
  internalError,
  noStoreJson,
  requireWatchingFollowUser,
} from '../route-utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireWatchingFollowUser(request);
    if (auth.response) return auth.response;

    const results = await updateCheckService.getResultsForUser(auth.username);
    return noStoreJson({
      userId: auth.username,
      generatedAt: Date.now(),
      results,
    });
  } catch (error) {
    return internalError(error);
  }
}
