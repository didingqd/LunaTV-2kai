/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/update-check-capability', () => ({
  updateCheckCapabilityService: { getCapability: jest.fn() },
}));
jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: { getResultsForUser: jest.fn() },
}));
jest.mock('../route-utils', () => ({
  requireWatchingFollowUser: jest.fn(async () => ({ username: 'alice' })),
  noStoreJson: (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, init),
  internalError: jest.fn(),
}));

import { updateCheckCapabilityService } from '@/lib/update-check-capability';
import { updateCheckService } from '@/lib/update-check-service';
import { GET } from './route';

const getCapability = updateCheckCapabilityService.getCapability as jest.Mock;
const getResults = updateCheckService.getResultsForUser as jest.Mock;

describe('watching update results capability', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns local mode with null results when the backend is disabled', async () => {
    getCapability.mockResolvedValue({
      enabled: false,
      backendEnabled: false,
      userEnabled: false,
      mode: 'local',
      reason: 'backend_disabled',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/watching-updates/results'),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      enabled: false,
      mode: 'local',
      results: null,
    });
    expect(getResults).not.toHaveBeenCalled();
  });

  it('returns backend mode with an empty array when no result exists', async () => {
    getCapability.mockResolvedValue({
      enabled: true,
      backendEnabled: true,
      userEnabled: true,
      mode: 'backend',
    });
    getResults.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/watching-updates/results'),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      enabled: true,
      mode: 'backend',
      generatedAt: 0,
      results: [],
    });
  });

  it('returns detectedAt from a backend UpdateResult', async () => {
    getCapability.mockResolvedValue({
      enabled: true,
      backendEnabled: true,
      userEnabled: true,
      mode: 'backend',
    });
    getResults.mockResolvedValue([{ checkedAt: 2000, detectedAt: 1500 }]);

    const response = await GET(
      new NextRequest('http://localhost/api/watching-updates/results'),
    );
    const body = await response.json();

    expect(body.generatedAt).toBe(2000);
    expect(body.results).toEqual([
      expect.objectContaining({ detectedAt: 1500 }),
    ]);
  });
});
