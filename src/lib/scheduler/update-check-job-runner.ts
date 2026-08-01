import {
  updateCheckScheduler,
  type UpdateCheckScheduler,
  type UpdateCheckSchedulerOptions,
  type UpdateCheckSchedulerResult,
} from '@/lib/update-check-scheduler';
import { notificationDispatcher } from '@/lib/notification/notification-dispatcher';
import type { NotificationPayload } from '@/lib/notification/notification-types';
import { timezoneService } from '@/lib/services/timezone_service';
import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
} from '@/lib/system-config-repository';
import type { UpdateCheckTask, UpdateResult } from '@/lib/update-check-types';
import {
  createWatchingUpdateCheckLogResult,
  watchingUpdateCheckLogService,
  type WatchingUpdateCheckLogService,
} from '@/lib/watching-update-check-log-service';
import type {
  WatchingUpdateCheckLogEntry,
  WatchingUpdateCheckLogExecutionSource,
  WatchingUpdateCheckLogOperation,
  WatchingUpdateCheckLogRequest,
  WatchingUpdateCheckLogSource,
} from '@/lib/watching-update-check-log-types';

export type UpdateCheckJobTrigger = 'cron' | 'manual' | 'trigger-link';

export interface UpdateCheckJobRunnerAuditOptions {
  source?: WatchingUpdateCheckLogSource;
  operation?: WatchingUpdateCheckLogOperation;
  request?: WatchingUpdateCheckLogRequest;
  userIds?: string[];
}

export interface UpdateCheckJobRunnerOptions {
  trigger: UpdateCheckJobTrigger;
  requestedBy?: string;
  limit?: number;
  ignoreSchedule?: boolean;
  preserveNextCheckAt?: boolean;
  onTaskComplete?: UpdateCheckSchedulerOptions['onTaskComplete'];
  /**
   * Stage 4H-H: API routes and non-HTTP schedulers pass request metadata here
   * so JobRunner can be the shared execution audit boundary without coupling
   * routes, SchedulerManager, or UpdateCheckScheduler to the log repository.
   */
  audit?: UpdateCheckJobRunnerAuditOptions;
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
type UpdateCheckAuditLogger = Pick<WatchingUpdateCheckLogService, 'record'>;
type NotificationPayloadDispatcher = {
  dispatchPayload: typeof notificationDispatcher.dispatchPayload;
};

interface CompletedAuditTask {
  task: UpdateCheckTask;
  result: UpdateResult | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function auditSourceForTrigger(
  trigger: UpdateCheckJobTrigger,
): WatchingUpdateCheckLogSource {
  return trigger === 'cron' ? 'cron' : 'trigger';
}

function auditOperationForTrigger(
  trigger: UpdateCheckJobTrigger,
): WatchingUpdateCheckLogOperation {
  return trigger === 'cron' ? 'scheduled-check' : 'manual-trigger';
}

function executionSourceForTrigger(
  trigger: UpdateCheckJobTrigger,
): WatchingUpdateCheckLogExecutionSource {
  return trigger === 'cron' ? 'scheduler' : 'manual';
}

function uniqueUserIds(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => !!value),
    ),
  );
}

function defaultAuditPath(source: WatchingUpdateCheckLogSource): string {
  if (source === 'cron') return 'scheduler://update-checks';
  if (source === 'trigger') return '/api/watching-updates/trigger';
  return 'jobrunner://watching-updates';
}

function createDefaultAuditRequest(
  options: UpdateCheckJobRunnerOptions,
  source: WatchingUpdateCheckLogSource,
): WatchingUpdateCheckLogRequest {
  const userId = source === 'cron' ? undefined : options.requestedBy;
  return {
    method: source === 'cron' ? 'SCHEDULED' : 'POST',
    path: defaultAuditPath(source),
    ...(userId ? { userId } : {}),
    ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
    trigger: options.trigger,
    client: {
      platform: 'server',
      device: 'server',
    },
  };
}

function createSchedulerFailedPayload(input: {
  userId: string;
  taskName: string;
  error: string;
  timestamp: number;
  displayTime: string;
}): NotificationPayload {
  const message = `${input.taskName} 执行失败：${input.error}。执行时间：${input.displayTime}`;
  return {
    type: 'scheduler.failed',
    targetUser: input.userId,
    occurredAt: input.timestamp,
    data: {
      taskName: input.taskName,
      error: input.error,
      timestamp: input.timestamp,
      displayTime: input.displayTime,
      title: '调度失败',
      message,
      content: message,
      level: 'error',
    },
    metadata: {
      source: 'update-check-job-runner',
      taskName: input.taskName,
      displayTime: input.displayTime,
    },
  };
}

function createAuditRequest(
  options: UpdateCheckJobRunnerOptions,
  source: WatchingUpdateCheckLogSource,
): WatchingUpdateCheckLogRequest {
  const fallback = createDefaultAuditRequest(options, source);
  if (!options.audit?.request) return fallback;
  return {
    ...fallback,
    ...options.audit.request,
    client: {
      ...fallback.client,
      ...options.audit.request.client,
    },
    ...(options.audit.request.requestedBy || !options.requestedBy
      ? {}
      : { requestedBy: options.requestedBy }),
    ...(options.audit.request.trigger ? {} : { trigger: options.trigger }),
  };
}

function createExecutionResult(
  options: UpdateCheckJobRunnerOptions,
  result: UpdateCheckJobRunnerResult,
  auditTasks: CompletedAuditTask[],
) {
  const checkedUsers = uniqueUserIds(
    auditTasks.map((item) => item.task.userId),
  );
  const updatedUsers = uniqueUserIds(
    auditTasks
      .filter((item) => item.result?.hasUpdate)
      .map((item) => item.task.userId),
  );
  const failedUsers = uniqueUserIds(
    auditTasks
      .filter((item) => item.result === null)
      .map((item) => item.task.userId),
  );

  if (options.trigger === 'cron') {
    return {
      trigger: 'cron' as const,
      checkedUsers,
      updatedUsers,
      failedUsers,
      result: result.schedulerResult,
    };
  }

  return {
    trigger: 'manual-trigger' as const,
    ...(options.requestedBy ? { username: options.requestedBy } : {}),
    result: result.schedulerResult,
  };
}

export class UpdateCheckJobRunner {
  private running = false;

  constructor(
    private readonly scheduler: UpdateCheckSchedulerRunner = updateCheckScheduler,
    private readonly now: () => number = Date.now,
    private readonly auditLogger: UpdateCheckAuditLogger | null = watchingUpdateCheckLogService,
    private readonly notifications: NotificationPayloadDispatcher = notificationDispatcher,
    private readonly config: UpdateCheckConfigReader = systemConfigRepository,
  ) {}

  async run(
    options: UpdateCheckJobRunnerOptions,
  ): Promise<UpdateCheckJobRunnerResult> {
    const auditTasks: CompletedAuditTask[] = [];
    let auditLogId: string | null = null;
    const onTaskComplete: UpdateCheckSchedulerOptions['onTaskComplete'] =
      async (value) => {
        auditTasks.push({ task: value.task, result: value.result });
        await options.onTaskComplete?.(value);
      };

    if (this.running) {
      const rejectedAt = this.now();
      auditLogId = await this.recordAuditLog({
        options,
        stage: 'started',
        startedAt: rejectedAt,
        finishedAt: rejectedAt,
        success: true,
        auditTasks,
      });
      const result: UpdateCheckJobRunnerResult = {
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
      await this.recordAuditLog({
        options,
        stage: 'finished',
        result,
        auditTasks,
        auditLogId,
      });
      return result;
    }

    this.running = true;
    const startedAt = this.now();
    auditLogId = await this.recordAuditLog({
      options,
      stage: 'started',
      startedAt,
      finishedAt: startedAt,
      success: true,
      auditTasks,
    });

    let result: UpdateCheckJobRunnerResult;
    try {
      const schedulerResult = await this.scheduler.run({
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.ignoreSchedule === undefined
          ? {}
          : { ignoreSchedule: options.ignoreSchedule }),
        ...(options.preserveNextCheckAt === undefined
          ? {}
          : { preserveNextCheckAt: options.preserveNextCheckAt }),
        onTaskComplete,
      });
      const finishedAt = this.now();
      result = {
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
      const message = errorMessage(error);
      result = {
        trigger: options.trigger,
        ...(options.requestedBy === undefined
          ? {}
          : { requestedBy: options.requestedBy }),
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        running: false,
        success: false,
        error: message,
        schedulerResult: null,
      };
      await this.dispatchSchedulerFailure(options, message, finishedAt);
    }

    await this.recordAuditLog({
      options,
      stage: 'finished',
      result,
      auditTasks,
      auditLogId,
    });
    this.running = false;
    return result;
  }

  private async recordAuditLog(input: {
    options: UpdateCheckJobRunnerOptions;
    stage: 'started' | 'finished';
    startedAt?: number;
    finishedAt?: number;
    success?: boolean;
    result?: UpdateCheckJobRunnerResult;
    auditTasks: CompletedAuditTask[];
    auditLogId?: string | null;
  }): Promise<string | null> {
    if (!this.auditLogger) return null;
    try {
      const source =
        input.options.audit?.source ??
        auditSourceForTrigger(input.options.trigger);
      const operation =
        input.options.audit?.operation ??
        auditOperationForTrigger(input.options.trigger);
      const request = createAuditRequest(input.options, source);
      const startedAt =
        input.result?.startedAt ?? input.startedAt ?? this.now();
      const finishedAt =
        input.result?.finishedAt ?? input.finishedAt ?? startedAt;
      const schedulerResult = input.result?.schedulerResult;
      const completedResults = input.auditTasks.flatMap((item) =>
        item.result ? [item.result] : [],
      );
      const taskUserIds = input.auditTasks.map((item) => item.task.userId);
      const userIds = uniqueUserIds([
        ...(input.options.audit?.userIds ?? []),
        ...taskUserIds,
        source === 'cron' ? undefined : input.options.requestedBy,
      ]);

      const checkedCount =
        input.stage === 'started'
          ? 0
          : (schedulerResult?.inspected ?? input.auditTasks.length);
      const successCount =
        input.stage === 'started'
          ? 0
          : (schedulerResult?.succeeded ?? completedResults.length);
      const failureCount =
        input.stage === 'started'
          ? 0
          : (schedulerResult?.failed ??
            Math.max(0, input.auditTasks.length - completedResults.length));

      const entry: Omit<WatchingUpdateCheckLogEntry, 'id'> = {
        source,
        operation,
        request,
        execution: {
          stage: input.stage,
          source: executionSourceForTrigger(input.options.trigger),
          startedAt,
          endedAt: finishedAt,
          finishedAt,
          durationMs: Math.max(0, finishedAt - startedAt),
          success: input.success ?? input.result?.success ?? false,
          ...(input.result?.error ? { error: input.result.error } : {}),
        },
        result: {
          ...createWatchingUpdateCheckLogResult({
            checkedCount,
            successCount,
            failureCount,
            results: input.stage === 'started' ? [] : completedResults,
          }),
          ...(input.stage === 'finished' && input.result
            ? createExecutionResult(
                input.options,
                input.result,
                input.auditTasks,
              )
            : {}),
        },
      };

      return await this.auditLogger.record(entry, {
        ...(userIds.length > 0 ? { userIds } : {}),
        ...(input.auditLogId ? { id: input.auditLogId } : {}),
        ...(input.stage === 'finished' ? { replaceExisting: true } : {}),
      });
    } catch (error) {
      console.error(
        'Failed to record watching update check job audit log',
        error,
      );
      return null;
    }
  }

  private async dispatchSchedulerFailure(
    options: UpdateCheckJobRunnerOptions,
    error: string,
    timestamp: number,
  ): Promise<void> {
    const userId = options.requestedBy ?? process.env.USERNAME;
    if (!userId) return;

    try {
      const displayTime =
        await this.resolveSchedulerFailureDisplayTime(timestamp);
      const result = await this.dispatchNotificationPayload(
        createSchedulerFailedPayload({
          userId,
          taskName: 'update-checks',
          error,
          timestamp,
          displayTime,
        }),
      );
      if (!result.success) {
        console.error(
          'Update check scheduler failure notification dispatch failed',
          result.errors,
        );
      }
    } catch (dispatchError) {
      console.error(
        'Update check scheduler failure notification dispatch threw',
        dispatchError,
      );
    }
  }

  private dispatchNotificationPayload(payload: NotificationPayload) {
    return this.notifications.dispatchPayload(payload);
  }

  private async resolveSchedulerFailureDisplayTime(
    timestamp: number,
  ): Promise<string> {
    try {
      const config = await this.config.getUpdateCheckConfig();
      return timezoneService.format(timestamp, config.updateCheckTimezone);
    } catch {
      return timezoneService.format(timestamp, 'UTC');
    }
  }
}

export const updateCheckJobRunner = new UpdateCheckJobRunner();
