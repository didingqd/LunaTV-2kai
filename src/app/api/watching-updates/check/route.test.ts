/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/update-check-capability', () => ({
  updateCheckCapabilityService: { getCapability: jest.fn() },
}));
jest.mock('@/lib/update-check-service', () => ({
  updateCheckService: { checkUser: jest.fn() },
}));
jest.mock('@/lib/watching-update-check-log-service', () => {
  const actual = jest.requireActual('@/lib/watching-update-check-log-service');
  return {
    ...actual,
    watchingUpdateCheckLogService: { record: jest.fn() },
  };
});
jest.mock('../route-utils', () => ({
  requireWatchingFollowUser: jest.fn(async () => ({ username: 'alice' })),
  noStoreJson: (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, init),
  parseJsonBody: (request: NextRequest) => request.json(),
  internalError: jest.fn(),
}));

import { updateCheckCapabilityService } from '@/lib/update-check-capability';
import { updateCheckService } from '@/lib/update-check-service';
import { watchingUpdateCheckLogService } from '@/lib/watching-update-check-log-service';
import { POST } from './route';

const getCapability = updateCheckCapabilityService.getCapability as jest.Mock;
const checkUser = updateCheckService.checkUser as jest.Mock;
const recordLog = watchingUpdateCheckLogService.record as jest.Mock;

describe('watching update check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recordLog.mockResolvedValue(undefined);
  });

  it('delegates an enabled request to UpdateCheckService', async () => {
    getCapability.mockResolvedValue({
      enabled: true,
      backendEnabled: true,
      userEnabled: true,
      mode: 'backend',
    });
    checkUser.mockResolvedValue({
      results: [],
      errors: [],
    });

    const response = await POST(
      new NextRequest('http://localhost/api/watching-updates/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followIds: ['["source-a","video-1"]'] }),
      }),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      capability: { mode: 'backend' },
      results: [],
      errors: [],
    });
    expect(checkUser).toHaveBeenCalledWith('alice', ['["source-a","video-1"]']);
  });

  it('does not run a check when backend capability is local', async () => {
    getCapability.mockResolvedValue({
      enabled: false,
      backendEnabled: true,
      userEnabled: false,
      mode: 'local',
      reason: 'user_not_enabled',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/watching-updates/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      status: 'user_not_enabled',
      reason: 'user_not_enabled',
      results: [],
      errors: [],
    });
    expect(checkUser).not.toHaveBeenCalled();
  });

  it('keeps the check response successful when log storage fails', async () => {
    getCapability.mockResolvedValue({
      enabled: true,
      backendEnabled: true,
      userEnabled: true,
      mode: 'backend',
    });
    checkUser.mockResolvedValue({
      results: [],
      errors: [],
    });
    recordLog.mockRejectedValueOnce(new Error('log storage failed'));
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await POST(
      new NextRequest('http://localhost/api/watching-updates/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      capability: { mode: 'backend' },
      results: [],
      errors: [],
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to record watching update check log',
      expect.any(Error),
    );
    expect(checkUser).toHaveBeenCalledWith('alice', undefined);
    expect(recordLog).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
