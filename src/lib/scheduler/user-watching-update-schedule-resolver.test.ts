/** @jest-environment node */

import type { SystemConfig } from '@/lib/admin.types';

import { resolveUserWatchingUpdateSchedule } from './user-watching-update-schedule-resolver';

const systemConfig: SystemConfig = {
  updateCheckBackendEnabled: true,
  updateCheckSchedulerEnabled: true,
  updateCheckCronExpression: '*/30 * * * *',
  updateCheckTimezone: 'UTC',
  updateCheckLogRetentionCount: 200,
  updateCheckBatchSize: 100,
  updateCheckMaxUsers: 1000,
  updateCheckMaxFollowPerUser: 100,
};

const from = new Date('2026-07-30T12:01:00.000Z');

describe('resolveUserWatchingUpdateSchedule', () => {
  it('uses a user cron override', () => {
    const result = resolveUserWatchingUpdateSchedule({
      username: 'alice',
      userUpdateCheckBackendEnabled: true,
      systemConfig,
      userConfig: { cronExpression: '0 */6 * * *' },
      from,
    });

    expect(result.cronExpression).toBe('0 */6 * * *');
    expect(result.source.cron).toBe('user');
    expect(result.nextRunAt).toBe(
      new Date('2026-07-30T18:00:00.000Z').getTime(),
    );
  });

  it('uses a user timezone override', () => {
    const result = resolveUserWatchingUpdateSchedule({
      username: 'alice',
      userUpdateCheckBackendEnabled: true,
      systemConfig: { ...systemConfig, updateCheckCronExpression: '0 0 * * *' },
      userConfig: { timezone: 'Asia/Shanghai' },
      from,
    });

    expect(result.timezone).toBe('Asia/Shanghai');
    expect(result.source.timezone).toBe('user');
    expect(result.nextRunAt).toBe(
      new Date('2026-07-30T16:00:00.000Z').getTime(),
    );
  });

  it('inherits valid system scheduling values without a user config', () => {
    const result = resolveUserWatchingUpdateSchedule({
      username: 'alice',
      userUpdateCheckBackendEnabled: true,
      systemConfig,
      from,
    });

    expect(result).toMatchObject({
      enabled: true,
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
      source: { cron: 'system', timezone: 'system' },
    });
  });

  it('falls back when system scheduling values are invalid', () => {
    const result = resolveUserWatchingUpdateSchedule({
      username: 'alice',
      userUpdateCheckBackendEnabled: true,
      systemConfig: {
        ...systemConfig,
        updateCheckCronExpression: 'invalid',
        updateCheckTimezone: 'invalid/timezone',
      },
      from,
    });

    expect(result).toMatchObject({
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
      source: { cron: 'default', timezone: 'default' },
    });
  });

  it('ignores invalid user values and falls back to system values', () => {
    const result = resolveUserWatchingUpdateSchedule({
      username: 'alice',
      userUpdateCheckBackendEnabled: true,
      systemConfig,
      userConfig: {
        cronExpression: '*/5 * * * * *',
        timezone: 'invalid/timezone',
      },
      from,
    });

    expect(result).toMatchObject({
      cronExpression: '*/30 * * * *',
      timezone: 'UTC',
      source: { cron: 'system', timezone: 'system' },
    });
  });

  it('does not calculate a next run for a disabled user', () => {
    const result = resolveUserWatchingUpdateSchedule({
      username: 'alice',
      userUpdateCheckBackendEnabled: false,
      systemConfig,
      from,
    });

    expect(result.enabled).toBe(false);
    expect(result.nextRunAt).toBeNull();
  });

  it('does not calculate a next run when system scheduling is disabled', () => {
    const result = resolveUserWatchingUpdateSchedule({
      username: 'alice',
      userUpdateCheckBackendEnabled: true,
      systemConfig: { ...systemConfig, updateCheckSchedulerEnabled: false },
      from,
    });

    expect(result.enabled).toBe(false);
    expect(result.nextRunAt).toBeNull();
  });

  it('treats the owner as implicitly authorized', () => {
    const result = resolveUserWatchingUpdateSchedule({
      username: 'owner',
      isOwner: true,
      systemConfig,
      from,
    });

    expect(result.enabled).toBe(true);
    expect(result.nextRunAt).not.toBeNull();
  });
});
