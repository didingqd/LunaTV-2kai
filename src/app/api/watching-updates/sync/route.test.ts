/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/update-check-capability', () => ({
  updateCheckCapabilityService: { getCapability: jest.fn() },
}));
jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: { processObservation: jest.fn() },
}));
jest.mock('../route-utils', () => ({
  requireWatchingFollowUser: jest.fn(async () => ({ username: 'alice' })),
  noStoreJson: (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, init),
  parseJsonBody: (request: NextRequest) => request.json(),
  internalError: jest.fn(),
}));

import { updateCheckCapabilityService } from '@/lib/update-check-capability';
import { updateCheckService } from '@/lib/update-check-service';
import { POST } from './route';

const getCapability = updateCheckCapabilityService.getCapability as jest.Mock;
const processObservation = updateCheckService.processObservation as jest.Mock;

describe('watching update Observation sync', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects UpdateResult fields instead of accepting them as an Observation', async () => {
    const response = await POST(createRequest({ unwatchedCount: 3 }));

    expect(response.status).toBe(400);
    expect(processObservation).not.toHaveBeenCalled();
  });

  it('does not save an Observation when the user is not enabled', async () => {
    getCapability.mockResolvedValue({
      enabled: false,
      backendEnabled: true,
      userEnabled: false,
      mode: 'local',
      reason: 'user_not_enabled',
    });

    const response = await POST(createRequest());
    const body = await response.json();

    expect(body).toMatchObject({
      accepted: false,
      reason: 'user_not_enabled',
    });
    expect(processObservation).not.toHaveBeenCalled();
  });
});

function createRequest(extraObservation: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/watching-updates/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      observations: [
        {
          followId: '[\"source-a\",\"video-1\"]',
          source: 'source-a',
          resourceId: 'video-1',
          latestEpisode: 12,
          observedAt: 1000,
          ...extraObservation,
        },
      ],
    }),
  });
}
