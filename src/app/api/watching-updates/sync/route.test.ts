/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/update-check-capability', () => ({
  updateCheckCapabilityService: { getCapability: jest.fn() },
}));
jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: {
    getResultsForUser: jest.fn(),
    processObservation: jest.fn(),
  },
}));
jest.mock('@/lib/update-result-notification-dispatcher', () => ({
  resolveUpdateResultNotificationTimezone: jest.fn(async () => 'UTC'),
  updateResultNotificationDispatcher: {
    dispatchUpdateResultNotifications: jest.fn(async () => ({
      notificationCount: 1,
    })),
  },
}));
jest.mock('@/lib/watching-update-check-log-service', () => ({
  createWatchingUpdateCheckLogResult: jest.fn(
    ({ checkedCount, successCount, failureCount, results = [] }) => ({
      checkedCount,
      successCount,
      failureCount,
      updateFoundCount: results.filter((result: { hasUpdate?: boolean }) =>
        Boolean(result.hasUpdate),
      ).length,
      updates: [],
    }),
  ),
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  watchingUpdateCheckLogService: { record: jest.fn() },
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
import { updateResultNotificationDispatcher } from '@/lib/update-result-notification-dispatcher';
import { watchingUpdateCheckLogService } from '@/lib/watching-update-check-log-service';
import { POST } from './route';

const getCapability = updateCheckCapabilityService.getCapability as jest.Mock;
const getResultsForUser = updateCheckService.getResultsForUser as jest.Mock;
const processObservation = updateCheckService.processObservation as jest.Mock;
const dispatchUpdateResultNotifications =
  updateResultNotificationDispatcher.dispatchUpdateResultNotifications as jest.Mock;
const recordLog = watchingUpdateCheckLogService.record as jest.Mock;

describe('watching update Observation sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCapability.mockResolvedValue({
      enabled: true,
      backendEnabled: true,
      userEnabled: true,
      mode: 'backend',
    });
    getResultsForUser.mockResolvedValue([]);
  });

  it('rejects UpdateResult fields instead of accepting them as an Observation', async () => {
    const response = await POST(createRequest({ detectedAt: 1234 }));

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

  it('dispatches accepted Observation results as one app notification batch and records app sync log', async () => {
    const first = updateResult({ followId: '["source-a","video-1"]' });
    const second = updateResult({
      followId: '["source-a","video-2"]',
      resourceId: 'video-2',
      title: 'Demo 2',
    });
    processObservation
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    getResultsForUser.mockResolvedValue([first, second]);

    const response = await POST(
      createRequest(
        {},
        {
          followId: '["source-a","video-2"]',
          source: 'source-a',
          resourceId: 'video-2',
          latestEpisode: 13,
          observedAt: 1100,
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accepted).toHaveLength(2);
    expect(dispatchUpdateResultNotifications).toHaveBeenCalledTimes(1);
    expect(dispatchUpdateResultNotifications).toHaveBeenCalledWith({
      userId: 'alice',
      results: [first, second],
      allCurrentResults: [first, second],
      source: 'app',
      timezone: 'UTC',
    });
    expect(recordLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'app',
        operation: 'sync',
        result: expect.objectContaining({
          checkedCount: 2,
          successCount: 2,
          failureCount: 0,
        }),
      }),
    );
  });
});

function createRequest(
  extraObservation: Record<string, unknown> = {},
  ...extraObservations: Array<Record<string, unknown>>
) {
  return new NextRequest('http://localhost/api/watching-updates/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-lunatv-client-source': 'app',
    },
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
        ...extraObservations,
      ],
    }),
  });
}

function updateResult(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'alice',
    followId: '["source-a","video-1"]',
    source: 'source-a',
    resourceId: 'video-1',
    title: 'Demo',
    latestEpisode: 13,
    watchedEpisode: 12,
    unwatchedCount: 1,
    hasUpdate: true,
    checkedAt: 2000,
    expireAt: 3602000,
    status: 'fresh',
    revision: 1,
    metadata: {
      algorithmVersion: 1,
      completionThreshold: 80,
      baselineEpisode: 12,
      effectiveLatestEpisode: 13,
      releasedEpisodeCount: 1,
    },
    ...overrides,
  };
}
