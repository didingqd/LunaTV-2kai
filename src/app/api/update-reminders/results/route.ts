import { NextRequest } from 'next/server';

import { updateCheckService } from '@/lib/update-check-service';
import { updateCheckCapabilityService } from '@/lib/update-check-capability';
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

    const capability = await updateCheckCapabilityService.getCapability(
      auth.username,
    );
    if (!capability.enabled) {
      return noStoreJson({
        userId: auth.username,
        enabled: false,
        mode: 'local',
        capability,
        generatedAt: 0,
        results: null,
      });
    }

    const results = await updateCheckService.getResultsForUser(auth.username);
    return noStoreJson({
      userId: auth.username,
      enabled: true,
      mode: 'backend',
      capability,
      generatedAt:
        results.length > 0
          ? Math.max(...results.map((result) => result.checkedAt))
          : 0,
      results,
    });
  } catch (error) {
    return internalError(error);
  }
}
