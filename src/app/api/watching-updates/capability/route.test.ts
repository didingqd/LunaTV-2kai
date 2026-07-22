/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/update-check-capability', () => ({
  updateCheckCapabilityService: { getCapability: jest.fn() },
}));
jest.mock('../route-utils', () => ({
  requireWatchingFollowUser: jest.fn(async () => ({ username: 'alice' })),
  noStoreJson: (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, init),
  internalError: jest.fn(),
}));

import { updateCheckCapabilityService } from '@/lib/update-check-capability';
import { GET } from './route';

const getCapability = updateCheckCapabilityService.getCapability as jest.Mock;
const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

describe('watching update capability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
  });

  afterAll(() => {
    if (originalStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    }
  });

  it('reports an unsupported deployment explicitly', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';

    const body = await requestCapability();

    expect(body).toEqual({
      supported: false,
      enabled: false,
      userAllowed: false,
      backendEnabled: false,
      userEnabled: false,
      mode: 'local',
      reason: 'unsupported',
    });
    expect(getCapability).not.toHaveBeenCalled();
  });

  it.each([
    [
      'global switch disabled',
      {
        enabled: false,
        backendEnabled: false,
        userEnabled: false,
        mode: 'local',
        reason: 'backend_disabled',
      },
      {
        supported: true,
        enabled: false,
        userAllowed: false,
        backendEnabled: false,
        userEnabled: false,
        mode: 'local',
        reason: 'backend_disabled',
      },
    ],
    [
      'user not allowed',
      {
        enabled: false,
        backendEnabled: true,
        userEnabled: false,
        mode: 'local',
        reason: 'user_not_enabled',
      },
      {
        supported: true,
        enabled: true,
        userAllowed: false,
        backendEnabled: true,
        userEnabled: false,
        mode: 'local',
        reason: 'user_not_enabled',
      },
    ],
    [
      'user allowed',
      {
        enabled: true,
        backendEnabled: true,
        userEnabled: true,
        mode: 'backend',
      },
      {
        supported: true,
        enabled: true,
        userAllowed: true,
        backendEnabled: true,
        userEnabled: true,
        mode: 'backend',
      },
    ],
  ])('distinguishes %s', async (_, capability, expected) => {
    getCapability.mockResolvedValue(capability);

    await expect(requestCapability()).resolves.toEqual(expected);
    expect(getCapability).toHaveBeenCalledWith('alice');
  });
});

async function requestCapability() {
  const response = await GET(
    new NextRequest('http://localhost/api/watching-updates/capability'),
  );
  return response.json();
}
