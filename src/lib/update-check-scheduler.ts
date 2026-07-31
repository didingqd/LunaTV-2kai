import type { AdminConfig, SystemConfig } from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import { notificationDispatcher } from './notification/notification-dispatcher';
import {
  NotificationMessageType,
  type NotificationMessage,
} from './notification/notification-types';
import { resolveUserWatchingUpdateSchedule } from './scheduler/user-watching-update-schedule-resolver';
import {
  systemConfigRepository,
  type UpdateCheckConfigReader,
  type UpdateCheckUserAccessReader,
} from './system-config-repository';
import {
  CachedUpdateCheckTaskRepository,
  type UpdateCheckScheduleTaskRepository,
  type UpdateCheckTaskRepository,
} from './update-check-repository';
import {
  updateCheckService,
  type UpdateCheckService,
} from './update-check-service';
import type { UpdateCheckTask, UpdateResult } from './update-check-types';

type SchedulerTaskRepository = UpdateCheckTaskRepository &
  Pick<
    UpdateCheckScheduleTaskRepository,
    'listTasksByUser' | 'batchUpdateNextCheckAt'
  >;

interface CompletedTask {
  before: UpdateCheckTask;
  after: UpdateCheckTask | null;
  result: UpdateResult | null;
}

export interface UpdateCheckSchedulerOptions {
  limit?: number;
  now?: number;
  onTaskComplete?: (value: {
    task: UpdateCheckTask;
    result: UpdateResult | null;
  }) => void | Promise<void>;
}

export interface UpdateCheckSchedulerResult {
  inspected: number;
  succeeded: number;
  failed: number;
  oldestDueAt: number | null;
}

export class UpdateCheckScheduler {
  constructor(
    private readonly tasks: SchedulerTaskRepository = new CachedUpdateCheckTaskRepository(
      db,
    ),
    private readonly service: UpdateCheckService = updateCheckService,
    private readonly config: UpdateCheckConfigReader = systemConfigRepository,
    private readonly permissions: Pick<
      UpdateCheckUserAccessReader,
      'listUpdateCheckEnabledUserIds'
    > = systemConfigRepository,
    private readonly loadAdminConfig: () => Promise<AdminConfig> = getConfig,
    private readonly notifications: Pick<
      typeof notificationDispatcher,
      'dispatch'
    > = notificationDispatcher,
  ) {}

  async run(
    options: UpdateCheckSchedulerOptions = {},
  ): Promise<UpdateCheckSchedulerResult> {
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
    const [enabledUserIds, adminConfig] = await Promise.all([
      this.permissions.listUpdateCheckEnabledUserIds(),
      this.loadAdminConfig(),
    ]);
    const authorizedUsers = new Set(enabledUserIds);
    const ownerId = process.env.USERNAME;
    if (ownerId) authorizedUsers.add(ownerId);
    const usersById = new Map(
      adminConfig.UserConfig.Users.map((user) => [user.username, user]),
    );
    const selectedTasks: typeof dueTasks = [];
    const users = new Set<string>();
    const followCounts = new Map<string, number>();
    for (const task of dueTasks) {
      if (!authorizedUsers.has(task.userId)) continue;
      const user = usersById.get(task.userId);
      const schedule = resolveUserWatchingUpdateSchedule({
        username: task.userId,
        userUpdateCheckBackendEnabled: true,
        isOwner: task.userId === ownerId,
        systemConfig: settings,
        userConfig: user?.watchingUpdateConfig,
        from: new Date(now),
      });
      if (!schedule.enabled) continue;
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
    const completedTasks: CompletedTask[] = [];

    let cursor = 0;
    const worker = async () => {
      while (cursor < selectedTasks.length) {
        const task = selectedTasks[cursor++];
        const result = await this.service.checkTask(task);
        const latestTask = await this.tasks.get(task.id);
        const completedTask = { before: task, after: latestTask, result };
        completedTasks.push(completedTask);
        if (result) succeeded += 1;
        else failed += 1;
        await this.dispatchTaskNotification(completedTask);
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
    await this.rescheduleSuccessfulTasks(
      completedTasks,
      settings,
      usersById,
      authorizedUsers,
      ownerId,
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

  private async rescheduleSuccessfulTasks(
    completedTasks: CompletedTask[],
    settings: SystemConfig,
    usersById: Map<string, AdminConfig['UserConfig']['Users'][number]>,
    authorizedUsers: Set<string>,
    ownerId: string | undefined,
  ): Promise<void> {
    const byUser = new Map<
      string,
      {
        attemptedIds: Set<string>;
        successfulIds: Set<string>;
        latestSuccessAt: number;
      }
    >();

    for (const completed of completedTasks) {
      const current = byUser.get(completed.before.userId) ?? {
        attemptedIds: new Set<string>(),
        successfulIds: new Set<string>(),
        latestSuccessAt: Number.NEGATIVE_INFINITY,
      };
      current.attemptedIds.add(completed.before.id);
      if (
        typeof completed.after?.lastSuccessAt === 'number' &&
        completed.after.lastSuccessAt !== completed.before.lastSuccessAt
      ) {
        current.successfulIds.add(completed.before.id);
        current.latestSuccessAt = Math.max(
          current.latestSuccessAt,
          completed.after.lastSuccessAt,
        );
      }
      byUser.set(completed.before.userId, current);
    }

    for (const [username, state] of byUser) {
      if (state.successfulIds.size === 0) continue;
      const user = usersById.get(username);
      const schedule = resolveUserWatchingUpdateSchedule({
        username,
        userUpdateCheckBackendEnabled: authorizedUsers.has(username),
        isOwner: username === ownerId,
        systemConfig: settings,
        userConfig: user?.watchingUpdateConfig,
        from: new Date(state.latestSuccessAt),
      });
      if (!schedule.enabled || schedule.nextRunAt === null) continue;

      const userTasks = await this.tasks.listTasksByUser(username);
      const preservedTasks = userTasks.filter(
        (task) =>
          state.attemptedIds.has(task.id) && !state.successfulIds.has(task.id),
      );
      await this.tasks.batchUpdateNextCheckAt(username, schedule.nextRunAt);
      for (const task of preservedTasks) await this.tasks.save(task);
    }
  }

  private async dispatchTaskNotification(
    completedTask: CompletedTask,
  ): Promise<void> {
    const message = this.buildNotificationMessage(completedTask);
    if (!message) return;

    try {
      const result = await this.notifications.dispatch(message);
      if (!result.success) {
        console.error(
          'Update check notification dispatch failed',
          result.errors,
        );
      }
    } catch (error) {
      console.error('Update check notification dispatch threw', error);
    }
  }

  private buildNotificationMessage(
    completedTask: CompletedTask,
  ): NotificationMessage | null {
    if (completedTask.result?.hasUpdate) {
      return this.buildUpdateFoundMessage(completedTask);
    }

    if (
      typeof completedTask.after?.lastErrorAt === 'number' &&
      completedTask.after.lastErrorAt !== completedTask.before.lastErrorAt
    ) {
      return this.buildUpdateFailedMessage(completedTask);
    }

    return null;
  }

  private buildUpdateFoundMessage(
    completedTask: CompletedTask,
  ): NotificationMessage {
    const result = completedTask.result as UpdateResult;
    const releasedEpisodeCount = Math.max(
      0,
      result.metadata.releasedEpisodeCount ?? 0,
    );
    const previousEpisode = Math.max(
      0,
      result.latestEpisode - releasedEpisodeCount,
    );
    const sourceName = result.metadata.sourceName ?? completedTask.before.source;

    return {
      userId: completedTask.before.userId,
      type: NotificationMessageType.WATCHING_UPDATE_FOUND,
      title: `《${result.title}》发现更新`,
      content: `${sourceName} 已从 ${previousEpisode} 集更新到 ${result.latestEpisode} 集，检查时间：${formatNotificationTime(
        result.checkedAt,
      )}`,
      createdAt: result.checkedAt,
      payload: {
        resourceId: result.resourceId,
        source: result.source,
        previousEpisode,
        latestEpisode: result.latestEpisode,
        releasedEpisodeCount,
        taskId: completedTask.before.id,
        followId: completedTask.before.followId,
        checkedAt: result.checkedAt,
      },
    };
  }

  private buildUpdateFailedMessage(
    completedTask: CompletedTask,
  ): NotificationMessage {
    const failedAt =
      completedTask.after?.lastErrorAt ?? completedTask.before.updatedAt;
    const message = sanitizeNotificationError(completedTask.after?.lastError);

    return {
      userId: completedTask.before.userId,
      type: NotificationMessageType.WATCHING_UPDATE_FAILED,
      title: '追更检查失败',
      content: `${completedTask.before.source} 来源的资源 ${completedTask.before.resourceId} 检查失败：${message}。检查时间：${formatNotificationTime(
        failedAt,
      )}`,
      createdAt: failedAt,
      payload: {
        resourceId: completedTask.before.resourceId,
        source: completedTask.before.source,
        taskId: completedTask.before.id,
        followId: completedTask.before.followId,
        failedAt,
        error: message,
      },
    };
  }
}

export const updateCheckScheduler = new UpdateCheckScheduler();

function sanitizeNotificationError(error: string | undefined): string {
  const normalized = String(error ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^Error:\s*/i, '')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(
      /\bauthorization\s*:\s*.*?(?=\s+cookie\s*:|$)/gi,
      'Authorization: [redacted]',
    )
    .replace(/\bcookie\s*:\s*.*$/gi, 'Cookie: [redacted]')
    .trim();
  if (!normalized) return '资源站异常';
  return normalized.slice(0, 160);
}

function formatNotificationTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}
