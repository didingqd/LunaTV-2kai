import { db } from './db';
import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
  type UpdateCheckUserAccessReader,
} from './system-config-repository';
import {
  CachedUpdateCheckTaskRepository,
  type UpdateCheckTaskRepository,
} from './update-check-repository';
import {
  updateCheckService,
  type UpdateCheckService,
} from './update-check-service';
import type { UpdateCheckTask, UpdateResult } from './update-check-types';

export interface UpdateCheckSchedulerOptions {
  limit?: number;
  now?: number;
  onTaskComplete?: (value: {
    task: UpdateCheckTask;
    result: UpdateResult | null;
  }) => void | Promise<void>;
}

export class UpdateCheckScheduler {
  constructor(
    private readonly tasks: UpdateCheckTaskRepository = new CachedUpdateCheckTaskRepository(
      db,
    ),
    private readonly service: UpdateCheckService = updateCheckService,
    private readonly config: UpdateCheckConfigReader = systemConfigRepository,
    private readonly permissions: Pick<
      UpdateCheckUserAccessReader,
      'listUpdateCheckEnabledUserIds'
    > = systemConfigRepository,
  ) {}

  async run(options: UpdateCheckSchedulerOptions = {}) {
    const now = options.now ?? Date.now();
    const settings = await this.config.getUpdateCheckConfig();
    if (!settings.updateCheckBackendEnabled) {
      return { inspected: 0, succeeded: 0, failed: 0, oldestDueAt: null };
    }
    const limit = Math.max(
      1,
      Math.min(
        options.limit ?? settings.updateCheckBatchSize,
        settings.updateCheckBatchSize,
      ),
    );
    const dueTasks = await this.tasks.listDue(now, limit);
    const authorizedUsers = new Set(
      await this.permissions.listUpdateCheckEnabledUserIds(),
    );
    const ownerId = process.env.USERNAME;
    if (ownerId) authorizedUsers.add(ownerId);
    const selectedTasks: typeof dueTasks = [];
    const users = new Set<string>();
    const followCounts = new Map<string, number>();
    for (const task of dueTasks) {
      if (!authorizedUsers.has(task.userId)) continue;
      const count = followCounts.get(task.userId) ?? 0;
      if (
        !users.has(task.userId) &&
        users.size >= settings.updateCheckMaxUsers
      ) {
        continue;
      }
      if (count >= settings.updateCheckMaxFollowPerUser) continue;
      users.add(task.userId);
      followCounts.set(task.userId, count + 1);
      selectedTasks.push(task);
    }
    let succeeded = 0;
    let failed = 0;

    let cursor = 0;
    const worker = async () => {
      while (cursor < selectedTasks.length) {
        const task = selectedTasks[cursor++];
        const result = await this.service.checkTask(task);
        if (result) succeeded += 1;
        else failed += 1;
        if (options.onTaskComplete) {
          try {
            await options.onTaskComplete({ task, result });
          } catch (error) {
            console.error('Update check scheduler task callback failed', error);
          }
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(5, selectedTasks.length) }, worker),
    );

    return {
      inspected: selectedTasks.length,
      succeeded,
      failed,
      oldestDueAt:
        selectedTasks.length > 0
          ? Math.min(...selectedTasks.map((task) => task.nextCheckAt))
          : null,
    };
  }
}

export const updateCheckScheduler = new UpdateCheckScheduler();
