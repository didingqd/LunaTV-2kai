/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/admin-auth', () => ({
  getAdminRoleFromRequest: jest.fn(),
}));
jest.mock('@/lib/watching-update-check-log-service', () => ({
  watchingUpdateCheckLogService: { list: jest.fn() },
}));

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { watchingUpdateCheckLogService } from '@/lib/watching-update-check-log-service';
import { GET } from './route';

const getRole = getAdminRoleFromRequest as jest.Mock;
const listLogs = watchingUpdateCheckLogService.list as jest.Mock;

function request(query = '') {
  return new NextRequest(
    `http://localhost/api/admin/watching-update-check-logs${query}`,
  );
}

describe('GET /api/admin/watching-update-check-logs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRole.mockResolvedValue('owner');
    listLogs.mockResolvedValue([{ id: 'log-1' }]);
  });

  it('keeps the response shape compatible', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      logs: [{ id: 'log-1' }],
      total: 1,
    });
  });

  it('passes limit, source, and userId filters to the service', async () => {
    await GET(request('?limit=50&source=cron&userId=alice'));

    expect(listLogs).toHaveBeenCalledWith({
      limit: 50,
      source: 'cron',
      userId: 'alice',
    });
  });

  it('returns 403 when the requester is not an admin', async () => {
    getRole.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(listLogs).not.toHaveBeenCalled();
  });

  it('accepts trigger source filters', async () => {
    await GET(request('?source=trigger'));

    expect(listLogs).toHaveBeenCalledWith({
      limit: 200,
      source: 'trigger',
      userId: undefined,
    });
  });

  it('rejects invalid query parameters', async () => {
    const response = await GET(request('?limit=5001'));

    expect(response.status).toBe(400);
    expect(listLogs).not.toHaveBeenCalled();
  });
});
