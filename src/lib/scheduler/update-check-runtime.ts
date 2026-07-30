import type { SystemConfig } from '@/lib/admin.types';

import {
  updateCheckScheduleReconciler,
  type SystemScheduleField,
  type UpdateCheckScheduleReconciler,
} from './update-check-schedule-reconciler';
import { schedulerManager } from './scheduler-manager';

type RuntimeReconciler = Pick<
  UpdateCheckScheduleReconciler,
  'reconcileUser' | 'reconcileUsersInheritingSystemSchedule'
>;

export class UpdateCheckRuntime {
  constructor(
    private readonly reconciler: RuntimeReconciler = updateCheckScheduleReconciler,
    private readonly reloadHandler: () => Promise<void> = async () => {
      schedulerManager.reload();
    },
  ) {}

  reconcileUser(username: string) {
    return this.reconciler.reconcileUser(username);
  }

  reconcileInheritedUsers(field: SystemScheduleField = 'all') {
    return this.reconciler.reconcileUsersInheritingSystemSchedule(field);
  }

  reload(): Promise<void> {
    return this.reloadHandler();
  }

  schedulerEnabledChanged(_enabled: boolean): Promise<void> {
    return this.reload();
  }

  async handleSystemConfigChanged(
    previous: SystemConfig | undefined,
    current: SystemConfig | undefined,
  ): Promise<void> {
    const cronChanged =
      previous?.updateCheckCronExpression !==
      current?.updateCheckCronExpression;
    const timezoneChanged =
      previous?.updateCheckTimezone !== current?.updateCheckTimezone;

    if (cronChanged || timezoneChanged) {
      const field: SystemScheduleField =
        cronChanged && timezoneChanged
          ? 'all'
          : cronChanged
            ? 'cron'
            : 'timezone';
      await this.reconcileInheritedUsers(field);
    }

    if (
      previous?.updateCheckSchedulerEnabled !==
      current?.updateCheckSchedulerEnabled
    ) {
      await this.schedulerEnabledChanged(
        current?.updateCheckSchedulerEnabled === true,
      );
    }
  }
}

export const updateCheckRuntime = new UpdateCheckRuntime();
