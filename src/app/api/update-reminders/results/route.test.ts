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

describe('update reminder results capability', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns local mode with null results when the backend is disabled', async () => {
    getCapability.mockResolvedValue({
      enabled: false,
      mode: 'local',
      reason: 'backend_disabled',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/update-reminders/results'),
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
    getCapability.mockResolvedValue({ enabled: true, mode: 'backend' });
    getResults.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/update-reminders/results'),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      enabled: true,
      mode: 'backend',
      generatedAt: 0,
      results: [],
    });
  });
});
