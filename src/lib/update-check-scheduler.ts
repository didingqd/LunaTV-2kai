import {
  CachedUpdateCheckTaskRepository,
  type UpdateCheckTaskRepository,
} from './update-check-repository';
import {
  updateCheckService,
  type UpdateCheckService,
} from './update-check-service';

export interface UpdateCheckSchedulerOptions {
  limit?: number;
  now?: number;
}

export class UpdateCheckScheduler {
  constructor(
    private readonly tasks: UpdateCheckTaskRepository = new CachedUpdateCheckTaskRepository(),
    private readonly service: UpdateCheckService = updateCheckService,
  ) {}

  async run(options: UpdateCheckSchedulerOptions = {}) {
    const now = options.now ?? Date.now();
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const dueTasks = await this.tasks.listDue(now, limit);
    let succeeded = 0;
    let failed = 0;

    let cursor = 0;
    const worker = async () => {
      while (cursor < dueTasks.length) {
        const task = dueTasks[cursor++];
        const result = await this.service.checkTask(task);
        if (result) succeeded += 1;
        else failed += 1;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(5, dueTasks.length) }, worker),
    );

    return {
      inspected: dueTasks.length,
      succeeded,
      failed,
      oldestDueAt:
        dueTasks.length > 0
          ? Math.min(...dueTasks.map((task) => task.nextCheckAt))
          : null,
    };
  }
}

export const updateCheckScheduler = new UpdateCheckScheduler();
