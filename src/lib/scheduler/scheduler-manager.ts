import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  CachedUpdateCheckTaskRepository,
  type UpdateCheckScheduleTaskRepository,
} from '@/lib/update-check-repository';

import {
  updateCheckJobRunner,
  type UpdateCheckJobRunner,
  type UpdateCheckJobRunnerOptions,
  type UpdateCheckJobRunnerResult,
} from './update-check-job-runner';

const DEFAULT_MAX_WAIT_MS = 60 * 1000;

type TimerHandle = ReturnType<typeof setTimeout>;

type SchedulerTaskReader = Pick<
  UpdateCheckScheduleTaskRepository,
  'findEarliestNextCheckAt'
>;

type SchedulerJobRunner = Pick<UpdateCheckJobRunner, 'run'>;

export interface SchedulerManagerOptions {
  tasks?: SchedulerTaskReader;
  jobRunner?: SchedulerJobRunner;
  loadEnabled?: () => Promise<boolean>;
  now?: () => number;
  maxWaitMs?: number;
  logger?: Pick<Console, 'debug' | 'error'>;
}

export class SchedulerManager {
  private running = false;
  private disposed = false;
  private timer: TimerHandle | null = null;
  private generation = 0;

  private readonly tasks: SchedulerTaskReader;
  private readonly jobRunner: SchedulerJobRunner;
  private readonly loadEnabled: () => Promise<boolean>;
  private readonly now: () => number;
  private readonly maxWaitMs: number;
  private readonly logger?: Pick<Console, 'debug' | 'error'>;

  constructor(options: SchedulerManagerOptions = {}) {
    this.tasks = options.tasks ?? new CachedUpdateCheckTaskRepository(db);
    this.jobRunner = options.jobRunner ?? updateCheckJobRunner;
    this.loadEnabled = options.loadEnabled ?? defaultLoadEnabled;
    this.now = options.now ?? Date.now;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.logger = options.logger;
  }

  start(): void {
    if (this.running && !this.disposed) return;
    this.disposed = false;
    this.running = true;
    this.generation += 1;
    this.logger?.debug?.('[update-check] scheduler manager started');
    void this.scheduleNext(this.generation);
  }

  stop(): void {
    if (!this.running && !this.timer) return;
    this.running = false;
    this.generation += 1;
    this.clearTimer();
    this.logger?.debug?.('[update-check] scheduler manager stopped');
  }

  reload(): void {
    if (!this.running || this.disposed) return;
    this.generation += 1;
    this.clearTimer();
    this.logger?.debug?.('[update-check] scheduler manager reload');
    void this.scheduleNext(this.generation);
  }

  async runNow(
    options: UpdateCheckJobRunnerOptions,
  ): Promise<UpdateCheckJobRunnerResult> {
    return this.jobRunner.run(options);
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private async scheduleNext(generation: number): Promise<void> {
    try {
      const delayMs = await this.calculateDelayMs();
      if (!this.shouldContinue(generation)) return;
      this.logger?.debug?.(
        `[update-check] scheduler manager next wakeup in ${delayMs}ms`,
      );
      this.timer = setTimeout(() => {
        void this.wake(generation);
      }, delayMs);
      this.timer.unref?.();
    } catch (error) {
      this.logger?.error?.(
        '[update-check] scheduler manager failed to schedule next wakeup',
        error,
      );
      if (!this.shouldContinue(generation)) return;
      this.timer = setTimeout(() => {
        void this.wake(generation);
      }, this.maxWaitMs);
      this.timer.unref?.();
    }
  }

  private async calculateDelayMs(): Promise<number> {
    const enabled = await this.loadEnabled();
    if (!enabled) return this.maxWaitMs;

    const earliestNextCheckAt = await this.tasks.findEarliestNextCheckAt();
    if (earliestNextCheckAt === null) return this.maxWaitMs;

    return Math.min(
      Math.max(0, earliestNextCheckAt - this.now()),
      this.maxWaitMs,
    );
  }

  private async wake(generation: number): Promise<void> {
    if (!this.shouldContinue(generation)) return;
    this.timer = null;
    try {
      if (await this.loadEnabled()) {
        const earliestNextCheckAt = await this.tasks.findEarliestNextCheckAt();
        if (earliestNextCheckAt !== null && earliestNextCheckAt <= this.now()) {
          await this.jobRunner.run({
            trigger: 'cron',
            triggerSource: 'cron_docker',
            requestedBy: 'docker',
          });
        }
      }
    } catch (error) {
      this.logger?.error?.(
        '[update-check] scheduler manager tick failed',
        error,
      );
    } finally {
      if (this.shouldContinue(generation)) {
        void this.scheduleNext(generation);
      }
    }
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private shouldContinue(generation: number): boolean {
    return this.running && !this.disposed && generation === this.generation;
  }
}

async function defaultLoadEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.SystemConfig.updateCheckSchedulerEnabled !== false;
}

export const schedulerManager = new SchedulerManager();
