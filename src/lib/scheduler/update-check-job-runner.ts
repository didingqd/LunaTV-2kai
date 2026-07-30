import {
  updateCheckScheduler,
  type UpdateCheckScheduler,
  type UpdateCheckSchedulerOptions,
  type UpdateCheckSchedulerResult,
} from '@/lib/update-check-scheduler';

export type UpdateCheckJobTrigger = 'cron' | 'manual' | 'trigger-link';

export interface UpdateCheckJobRunnerOptions {
  trigger: UpdateCheckJobTrigger;
  requestedBy?: string;
  limit?: number;
  onTaskComplete?: UpdateCheckSchedulerOptions['onTaskComplete'];
}

export interface UpdateCheckJobRunnerResult {
  trigger: UpdateCheckJobTrigger;
  requestedBy?: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  running: boolean;
  success: boolean;
  error?: string;
  schedulerResult: UpdateCheckSchedulerResult | null;
}

type UpdateCheckSchedulerRunner = Pick<UpdateCheckScheduler, 'run'>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class UpdateCheckJobRunner {
  private running = false;

  constructor(
    private readonly scheduler: UpdateCheckSchedulerRunner = updateCheckScheduler,
    private readonly now: () => number = Date.now,
  ) {}

  async run(
    options: UpdateCheckJobRunnerOptions,
  ): Promise<UpdateCheckJobRunnerResult> {
    if (this.running) {
      const rejectedAt = this.now();
      return {
        trigger: options.trigger,
        ...(options.requestedBy === undefined
          ? {}
          : { requestedBy: options.requestedBy }),
        startedAt: rejectedAt,
        finishedAt: rejectedAt,
        durationMs: 0,
        running: true,
        success: false,
        error: 'UPDATE_CHECK_ALREADY_RUNNING',
        schedulerResult: null,
      };
    }

    this.running = true;
    const startedAt = this.now();
    try {
      const schedulerResult = await this.scheduler.run(
        {
          ...(options.limit === undefined ? {} : { limit: options.limit }),
          ...(options.onTaskComplete === undefined
            ? {}
            : { onTaskComplete: options.onTaskComplete }),
        },
      );
      const finishedAt = this.now();
      return {
        trigger: options.trigger,
        ...(options.requestedBy === undefined
          ? {}
          : { requestedBy: options.requestedBy }),
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        running: false,
        success: true,
        schedulerResult,
      };
    } catch (error) {
      const finishedAt = this.now();
      return {
        trigger: options.trigger,
        ...(options.requestedBy === undefined
          ? {}
          : { requestedBy: options.requestedBy }),
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        running: false,
        success: false,
        error: errorMessage(error),
        schedulerResult: null,
      };
    } finally {
      this.running = false;
    }
  }
}

export const updateCheckJobRunner = new UpdateCheckJobRunner();
