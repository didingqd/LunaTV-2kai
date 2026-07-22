import { NextRequest, NextResponse } from 'next/server';

import {
  noStoreJson,
  requireWatchingFollowUser,
} from '@/app/api/watching-follows/route-utils';

export { noStoreJson, requireWatchingFollowUser };

export function parseJsonBody(request: NextRequest): Promise<unknown> {
  return request.json().catch(() => ({}));
}

export function internalError(error: unknown): NextResponse {
  console.error('Watching update request failed', error);
  return noStoreJson({ error: 'Internal Server Error' }, { status: 500 });
}
