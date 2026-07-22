import { NextRequest } from 'next/server';

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

    if (
      (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') ===
      'localstorage'
    ) {
      return noStoreJson({
        supported: false,
        enabled: false,
        userAllowed: false,
        backendEnabled: false,
        userEnabled: false,
        mode: 'local',
        reason: 'unsupported',
      });
    }

    const capability = await updateCheckCapabilityService.getCapability(
      auth.username,
    );
    return noStoreJson({
      supported: true,
      enabled: capability.backendEnabled,
      userAllowed: capability.userEnabled,
      backendEnabled: capability.backendEnabled,
      userEnabled: capability.userEnabled,
      mode: capability.mode,
      reason: capability.reason,
    });
  } catch (error) {
    return internalError(error);
  }
}
