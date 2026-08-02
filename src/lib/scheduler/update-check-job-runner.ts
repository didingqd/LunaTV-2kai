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
import type { WatchingUpdateNotificationPayloadData } from '@/lib/watching-update-notification-builder';
import {
  createWatchingUpdateCheckLogResult,
  toWatchingUpdateCheckLogUpdates,
  watchingUpdateCheckLogService,
  type WatchingUpdateCheckLogService,
} from '@/lib/watching-update-check-log-service';
import type {
  WatchingUpdateCheckLogEntry,
  WatchingUpdateCheckLogExecutionSource,
  WatchingUpdateCheckLogOperation,
  WatchingUpdateCheckLogRequest,
  WatchingUpdateCheckLogSource,
  WatchingUpdateCheckLogUpdate,
} from '@/lib/watching-update-check-log-types';

export type UpdateCheckJobTrigger = 'cron' | 'manual' | 'trigger-link';
export type UpdateCheckJobTriggerSource =
  | 'cron_vercel'
  | 'cron_docker'
  | 'external_http'
  | 'manual'
  | 'admin';
export type UpdateCheckJobStatusValue =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed';

export interface UpdateCheckJobResultSummary {
  inspected: number;
  succeeded: number;
  failed: number;
  oldestDueAt: number | null;
  dataSourceCount: number;
  updateFoundCount: number;
  updates: WatchingUpdateCheckLogUpdate[];
  notificationCount: number;
  skipped: number;
}

export interface UpdateCheckJobDisplayResult extends WatchingUpdateNotificationPayloadData {
  userId: string;
}

export interface UpdateCheckJobStatusSnapshot {
  taskId: string | null;
  status: UpdateCheckJobStatusValue;
  running: boolean;
  trigger: UpdateCheckJobTrigger | null;
  triggerSource: UpdateCheckJobTriggerSource | null;
  tokenId?: string;
  userId?: string;
  requestedBy?: string;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  result: UpdateCheckJobResultSummary | null;
  displayResults?: UpdateCheckJobDisplayResult[];
  error?: string;
}

export interface UpdateCheckJobRunnerAuditOptions {
  source?: WatchingUpdateCheckLogSource;
  operation?: WatchingUpdateCheckLogOperation;
  request?: WatchingUpdateCheckLogRequest;
  userIds?: string[];
}

export interface UpdateCheckJobRunnerOptions {
  mode?: 'scheduled' | 'user';
  trigger: UpdateCheckJobTrigger;
  triggerSource?: UpdateCheckJobTriggerSource;
  userId?: string;
  tokenId?: string;
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
  displayResults?: UpdateCheckJobDisplayResult[];
}

type UpdateCheckSchedulerRunner = Pick<UpdateCheckScheduler, 'run'>;
type UpdateCheckUserRunner = {
  runUser?: UpdateCheckScheduler['runUser'];
};
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

function createTaskId(startedAt: number): string {
  return `${startedAt}-${Math.random().toString(36).slice(2, 12)}`;
}

function resolveTriggerSource(
  options: UpdateCheckJobRunnerOptions,
): UpdateCheckJobTriggerSource {
  if (options.triggerSource) return options.triggerSource;
  if (options.trigger === 'cron') return 'cron_docker';
  return 'manual';
}

function summarizeSchedulerResult(
  result: UpdateCheckSchedulerResult,
  auditTasks: CompletedAuditTask[] = [],
): UpdateCheckJobResultSummary {
  const completedResults = auditTasks.flatMap((item) =>
    item.result ? [item.result] : [],
  );
  return {
    inspected: result.inspected,
    succeeded: result.succeeded,
    failed: result.failed,
    oldestDueAt: result.oldestDueAt,
    dataSourceCount: result.dataSourceCount,
    updateFoundCount: result.updateFoundCount,
    updates: toWatchingUpdateCheckLogUpdates(completedResults),
    notificationCount: result.notificationCount,
    skipped: result.skipped,
  };
}

function summarizeAuditProgress(
  auditTasks: CompletedAuditTask[],
): UpdateCheckJobResultSummary {
  const completedResults = auditTasks.flatMap((item) =>
    item.result ? [item.result] : [],
  );
  return {
    inspected: auditTasks.length,
    succeeded: completedResults.length,
    failed: Math.max(0, auditTasks.length - completedResults.length),
    oldestDueAt:
      auditTasks.length > 0
        ? Math.min(...auditTasks.map((item) => item.task.nextCheckAt))
        : null,
    dataSourceCount: new Set(auditTasks.map((item) => item.task.source)).size,
    updateFoundCount: completedResults.filter((result) => result.hasUpdate)
      .length,
    updates: toWatchingUpdateCheckLogUpdates(completedResults),
    notificationCount: 0,
    skipped: 0,
  };
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
  const userId =
    source === 'cron' ? undefined : (options.userId ?? options.requestedBy);
  return {
    method: source === 'cron' ? 'SCHEDULED' : 'POST',
    path: defaultAuditPath(source),
    ...(userId ? { userId } : {}),
    ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
    trigger: resolveTriggerSource(options),
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
    ...(options.audit.request.trigger
      ? {}
      : { trigger: resolveTriggerSource(options) }),
  };
}

function createExecutionResult(
  options: UpdateCheckJobRunnerOptions,
  result: UpdateCheckJobRunnerResult,
  auditTasks: CompletedAuditTask[],
) {
  const checkedUsers = uniqueUserIds([
    options.trigger === 'cron'
      ? undefined
      : (options.userId ?? options.requestedBy),
    ...auditTasks.map((item) => item.task.userId),
  ]);
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
      triggerSource: resolveTriggerSource(options),
      checkedUsers,
      updatedUsers,
      failedUsers,
      result: result.schedulerResult,
    };
  }

  return {
    trigger: 'manual-trigger' as const,
    triggerSource: resolveTriggerSource(options),
    ...(options.requestedBy ? { username: options.requestedBy } : {}),
    checkedUsers,
    updatedUsers,
    failedUsers,
    result: result.schedulerResult,
  };
}

export class UpdateCheckJobRunner {
  private running = false;
  private status: UpdateCheckJobStatusSnapshot = {
    taskId: null,
    status: 'idle',
    running: false,
    trigger: null,
    triggerSource: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    result: null,
  };

  constructor(
    private readonly scheduler: UpdateCheckSchedulerRunner &
      UpdateCheckUserRunner = updateCheckScheduler,
    private readonly now: () => number = Date.now,
    private readonly auditLogger: UpdateCheckAuditLogger | null = watchingUpdateCheckLogService,
    private readonly notifications: NotificationPayloadDispatcher = notificationDispatcher,
    private readonly config: UpdateCheckConfigReader = systemConfigRepository,
  ) {}

  getStatus(): UpdateCheckJobStatusSnapshot {
    return { ...this.status };
  }

  isRunning(): boolean {
    return this.running;
  }

  runInBackground(
    options: UpdateCheckJobRunnerOptions,
  ): UpdateCheckJobStatusSnapshot {
    if (!this.running) {
      void this.run(options).catch((error) => {
        console.error('Update check background job failed', error);
      });
    }
    return this.getStatus();
  }

  async run(
    options: UpdateCheckJobRunnerOptions,
  ): Promise<UpdateCheckJobRunnerResult> {
    const auditTasks: CompletedAuditTask[] = [];
    const displayResults: UpdateCheckJobDisplayResult[] = [];
    let auditLogId: string | null = null;
    const onTaskComplete: UpdateCheckSchedulerOptions['onTaskComplete'] =
      async (value) => {
        auditTasks.push({ task: value.task, result: value.result });
        if (this.status.status === 'running') {
          this.status = {
            ...this.status,
            result: summarizeAuditProgress(auditTasks),
          };
        }
        await options.onTaskComplete?.(value);
      };
    const onNotificationData: UpdateCheckSchedulerOptions['onNotificationData'] =
      async (value) => {
        displayResults.push({ userId: value.userId, ...value.data });
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

    const startedAt = this.now();
    const triggerSource = resolveTriggerSource(options);
    const taskId = createTaskId(startedAt);
    this.running = true;
    this.status = {
      taskId,
      status: 'running',
      running: true,
      trigger: options.trigger,
      triggerSource,
      ...(options.tokenId === undefined ? {} : { tokenId: options.tokenId }),
      ...((options.userId ?? options.requestedBy)
        ? { userId: options.userId ?? options.requestedBy }
        : {}),
      ...(options.requestedBy === undefined
        ? {}
        : { requestedBy: options.requestedBy }),
      startedAt,
      finishedAt: null,
      durationMs: null,
      result: null,
    };
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
      const schedulerOptions: UpdateCheckSchedulerOptions = {
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.ignoreSchedule === undefined
          ? {}
          : { ignoreSchedule: options.ignoreSchedule }),
        ...(options.preserveNextCheckAt === undefined
          ? {}
          : { preserveNextCheckAt: options.preserveNextCheckAt }),
        onTaskComplete,
        onNotificationData,
      };
      const schedulerResult =
        options.mode === 'user'
          ? await this.runUserScheduler(options, schedulerOptions)
          : await this.scheduler.run(schedulerOptions);
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
        ...(displayResults.length > 0 ? { displayResults } : {}),
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
        ...(displayResults.length > 0 ? { displayResults } : {}),
      };
      await this.dispatchSchedulerFailure(options, message, finishedAt);
    }

    try {
      await this.recordAuditLog({
        options,
        stage: 'finished',
        result,
        auditTasks,
        auditLogId,
      });
    } finally {
      this.status = {
        taskId,
        status: result.success ? 'completed' : 'failed',
        running: false,
        trigger: options.trigger,
        triggerSource,
        ...(options.tokenId === undefined ? {} : { tokenId: options.tokenId }),
        ...(options.requestedBy === undefined
          ? {}
          : { userId: options.requestedBy }),
        ...(options.requestedBy === undefined
          ? {}
          : { requestedBy: options.requestedBy }),
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        result: result.schedulerResult
          ? summarizeSchedulerResult(result.schedulerResult, auditTasks)
          : null,
        displayResults: result.displayResults,
        ...(result.error ? { error: result.error } : {}),
      };
      this.running = false;
    }
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
        input.options.userId,
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

  private runUserScheduler(
    options: UpdateCheckJobRunnerOptions,
    schedulerOptions: UpdateCheckSchedulerOptions,
  ): Promise<UpdateCheckSchedulerResult> {
    const userId = options.userId ?? options.requestedBy;
    if (!userId) throw new Error('UPDATE_CHECK_USER_REQUIRED');
    if (typeof this.scheduler.runUser !== 'function') {
      throw new Error('UPDATE_CHECK_USER_MODE_UNAVAILABLE');
    }
    return this.scheduler.runUser(userId, {
      ...schedulerOptions,
      preserveNextCheckAt: schedulerOptions.preserveNextCheckAt ?? true,
    });
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
