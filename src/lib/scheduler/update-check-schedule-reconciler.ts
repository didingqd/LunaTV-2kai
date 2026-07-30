import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  CachedUpdateCheckTaskRepository,
  type UpdateCheckScheduleTaskRepository,
} from '@/lib/update-check-repository';

import {
  resolveUserWatchingUpdateSchedule,
  type EffectiveUserWatchingUpdateSchedule,
} from './user-watching-update-schedule-resolver';

export type SystemScheduleField = 'cron' | 'timezone' | 'all';

export interface UpdateCheckScheduleReconcileResult {
  schedule: EffectiveUserWatchingUpdateSchedule;
  taskCount: number;
  updatedCount: number;
}

export class UpdateCheckScheduleReconciler {
  constructor(
    private readonly tasks: UpdateCheckScheduleTaskRepository = new CachedUpdateCheckTaskRepository(
      db,
    ),
    private readonly loadConfig: () => Promise<AdminConfig> = getConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly ownerUsername: () => string | undefined = () =>
      process.env.USERNAME,
  ) {}

  async reconcileUser(
    username: string,
  ): Promise<UpdateCheckScheduleReconcileResult> {
    return this.reconcileUserWithConfig(username, await this.loadConfig());
  }

  async reconcileUsersInheritingSystemSchedule(
    field: SystemScheduleField = 'all',
  ): Promise<UpdateCheckScheduleReconcileResult[]> {
    const config = await this.loadConfig();
    const usernames = await this.tasks.listAllUsersWithTasks();
    const results: UpdateCheckScheduleReconcileResult[] = [];
    for (const username of usernames) {
      const schedule = this.resolveSchedule(username, config);
      const inheritsChangedField =
        field === 'all'
          ? schedule.source.cron !== 'user' ||
            schedule.source.timezone !== 'user'
          : schedule.source[field] !== 'user';
      if (!inheritsChangedField) continue;
      results.push(
        await this.reconcileUserWithConfig(username, config, schedule),
      );
    }
    return results;
  }

  private async reconcileUserWithConfig(
    username: string,
    config: AdminConfig,
    resolvedSchedule?: EffectiveUserWatchingUpdateSchedule,
  ): Promise<UpdateCheckScheduleReconcileResult> {
    const schedule = resolvedSchedule ?? this.resolveSchedule(username, config);
    const userTasks = await this.tasks.listTasksByUser(username);
    if (
      !schedule.enabled ||
      schedule.nextRunAt === null ||
      userTasks.length === 0
    ) {
      return { schedule, taskCount: userTasks.length, updatedCount: 0 };
    }

    const updatedCount = await this.tasks.batchUpdateNextCheckAt(
      username,
      schedule.nextRunAt,
    );
    return { schedule, taskCount: userTasks.length, updatedCount };
  }

  private resolveSchedule(
    username: string,
    config: AdminConfig,
  ): EffectiveUserWatchingUpdateSchedule {
    const user = config.UserConfig.Users.find(
      (candidate) => candidate.username === username,
    );
    return resolveUserWatchingUpdateSchedule({
      username,
      userUpdateCheckBackendEnabled: user?.updateCheckBackendEnabled,
      isOwner: username === this.ownerUsername(),
      systemConfig: config.SystemConfig,
      userConfig: user?.watchingUpdateConfig,
      from: this.now(),
    });
  }
}

export const updateCheckScheduleReconciler =
  new UpdateCheckScheduleReconciler();
