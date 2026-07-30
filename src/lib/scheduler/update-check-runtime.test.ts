/** @jest-environment node */

import type { SystemConfig } from '@/lib/admin.types';

import { UpdateCheckRuntime } from './update-check-runtime';

function systemConfig(overrides: Partial<SystemConfig> = {}): SystemConfig {
  return {
    updateCheckBackendEnabled: true,
    updateCheckSchedulerEnabled: true,
    updateCheckCronInterval: 30 * 60 * 1000,
    updateCheckCronExpression: '*/30 * * * *',
    updateCheckTimezone: 'UTC',
    updateCheckLogRetentionCount: 200,
    updateCheckBatchSize: 100,
    updateCheckMaxUsers: 1000,
    updateCheckMaxFollowPerUser: 100,
    ...overrides,
  };
}

describe('UpdateCheckRuntime', () => {
  it('reconciles one user after a user cron override changes', async () => {
    const reconciler = createReconciler();
    const runtime = new UpdateCheckRuntime(reconciler);

    await runtime.reconcileUser('alice');

    expect(reconciler.reconcileUser).toHaveBeenCalledWith('alice');
    expect(
      reconciler.reconcileUsersInheritingSystemSchedule,
    ).not.toHaveBeenCalled();
  });

  it('reconciles one user after a user timezone override changes', async () => {
    const reconciler = createReconciler();
    const runtime = new UpdateCheckRuntime(reconciler);

    await runtime.reconcileUser('alice');

    expect(reconciler.reconcileUser).toHaveBeenCalledWith('alice');
    expect(
      reconciler.reconcileUsersInheritingSystemSchedule,
    ).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'reconciles one user after permission changes to %s',
    async (_enabled) => {
      const reconciler = createReconciler();
      const runtime = new UpdateCheckRuntime(reconciler);

      await runtime.reconcileUser('alice');

      expect(reconciler.reconcileUser).toHaveBeenCalledWith('alice');
      expect(
        reconciler.reconcileUsersInheritingSystemSchedule,
      ).not.toHaveBeenCalled();
    },
  );

  it('reconciles only cron-inheriting users after a system cron change', async () => {
    const reconciler = createReconciler();
    const runtime = new UpdateCheckRuntime(reconciler);

    await runtime.handleSystemConfigChanged(
      systemConfig(),
      systemConfig({ updateCheckCronExpression: '0 * * * *' }),
    );

    expect(
      reconciler.reconcileUsersInheritingSystemSchedule,
    ).toHaveBeenCalledWith('cron');
  });

  it('reconciles only timezone-inheriting users after a timezone change', async () => {
    const reconciler = createReconciler();
    const runtime = new UpdateCheckRuntime(reconciler);

    await runtime.handleSystemConfigChanged(
      systemConfig(),
      systemConfig({ updateCheckTimezone: 'Asia/Shanghai' }),
    );

    expect(
      reconciler.reconcileUsersInheritingSystemSchedule,
    ).toHaveBeenCalledWith('timezone');
  });

  it('reconciles inherited users once when cron and timezone both change', async () => {
    const reconciler = createReconciler();
    const runtime = new UpdateCheckRuntime(reconciler);

    await runtime.handleSystemConfigChanged(
      systemConfig(),
      systemConfig({
        updateCheckCronExpression: '0 */6 * * *',
        updateCheckTimezone: 'Europe/Berlin',
      }),
    );

    expect(
      reconciler.reconcileUsersInheritingSystemSchedule,
    ).toHaveBeenCalledTimes(1);
    expect(
      reconciler.reconcileUsersInheritingSystemSchedule,
    ).toHaveBeenCalledWith('all');
  });

  it.each([true, false])(
    'reloads after scheduler enabled changes to %s',
    async (enabled) => {
      const reconciler = createReconciler();
      const reload = jest.fn().mockResolvedValue(undefined);
      const runtime = new UpdateCheckRuntime(reconciler, reload);

      await runtime.handleSystemConfigChanged(
        systemConfig({ updateCheckSchedulerEnabled: !enabled }),
        systemConfig({ updateCheckSchedulerEnabled: enabled }),
      );

      expect(reload).toHaveBeenCalledTimes(1);
    },
  );

  it('does not reconcile or reload after a retention-only change', async () => {
    const reconciler = createReconciler();
    const reload = jest.fn().mockResolvedValue(undefined);
    const runtime = new UpdateCheckRuntime(reconciler, reload);

    await runtime.handleSystemConfigChanged(
      systemConfig(),
      systemConfig({ updateCheckLogRetentionCount: 500 }),
    );

    expect(reconciler.reconcileUser).not.toHaveBeenCalled();
    expect(
      reconciler.reconcileUsersInheritingSystemSchedule,
    ).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

function createReconciler() {
  return {
    reconcileUser: jest.fn().mockResolvedValue(undefined),
    reconcileUsersInheritingSystemSchedule: jest.fn().mockResolvedValue([]),
  };
}
