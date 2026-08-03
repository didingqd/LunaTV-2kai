import { getConfig } from './config';
import { db } from './db';
import { notificationDispatcher } from './notification/notification-dispatcher';
import type { NotificationPayload } from './notification/notification-types';
import { normalizeTimezone } from './scheduler/timezone-utils';
import { resolveUserWatchingUpdateSchedule } from './scheduler/user-watching-update-schedule-resolver';
import { timezoneService } from './services/timezone_service';
import { systemConfigRepository } from './system-config-repository';
import {
  CachedWatchingUpdateNotificationStateRepository,
  type WatchingUpdateNotificationStateRepository,
} from './update-check-repository';
import type { UpdateResult } from './update-check-types';
import { updateDiffAnalyzer } from './update-diff-analyzer';
import {
  createWatchingUpdateFoundPayload,
  registerWatchingUpdateNotificationBuilder,
  type WatchingUpdateNotificationPayloadData,
} from './watching-update-notification-builder';

export type UpdateResultNotificationSource = 'cron' | 'app';

type NotificationPayloadDispatcher = {
  dispatchPayload: typeof notificationDispatcher.dispatchPayload;
};

export interface DispatchUpdateResultNotificationsInput {
  userId: string;
  results: UpdateResult[];
  source: UpdateResultNotificationSource;
  timezone: string;
  allCurrentResults?: UpdateResult[];
  onNotificationData?: (value: {
    userId: string;
    data: WatchingUpdateNotificationPayloadData;
  }) => void | Promise<void>;
}

export interface DispatchUpdateResultNotificationsResult {
  notificationCount: number;
}

export class UpdateResultNotificationDispatcher {
  constructor(
    private readonly notifications: NotificationPayloadDispatcher = notificationDispatcher,
    private readonly notificationState: WatchingUpdateNotificationStateRepository = new CachedWatchingUpdateNotificationStateRepository(
      db,
    ),
  ) {
    registerWatchingUpdateNotificationBuilder();
  }

  async dispatchUpdateResultNotifications(
    input: DispatchUpdateResultNotificationsInput,
  ): Promise<DispatchUpdateResultNotificationsResult> {
    const results = input.results.filter(Boolean);
    if (results.length === 0) return { notificationCount: 0 };

    const checkedAt = Math.max(...results.map((result) => result.checkedAt));
    const allCurrentResults = input.allCurrentResults ?? results;
    const previousState = await this.notificationState.get(input.userId);
    const analysis = updateDiffAnalyzer.analyze(
      results.flatMap(toNotificationCandidate),
      previousState,
      checkedAt,
      allCurrentResults.flatMap(toNotificationCandidate),
    );

    if (Number.isFinite(checkedAt)) {
      const displayTime = formatNotificationTime(checkedAt, input.timezone);
      await this.notifyDisplayData(input, {
        userId: input.userId,
        data: {
          title: '更新提醒',
          newUpdates: analysis.newUpdates,
          updated: analysis.updated,
          checkedAt,
          timezone: input.timezone,
          displayTime,
        },
      });
    }

    if (analysis.newUpdates.length === 0) {
      await this.notificationState.save(input.userId, analysis.nextState);
      return { notificationCount: 0 };
    }

    const displayTime = formatNotificationTime(checkedAt, input.timezone);

    try {
      const result = await this.dispatchNotificationPayload(
        createWatchingUpdateFoundPayload({
          userId: input.userId,
          newUpdates: analysis.newUpdates,
          updated: analysis.updated,
          checkedAt,
          timezone: input.timezone,
          displayTime,
        }),
      );
      if (!result.success || result.succeeded <= 0) {
        console.error(
          'Update check notification dispatch failed',
          result.errors,
        );
        return { notificationCount: result.succeeded };
      }
      await this.notificationState.save(input.userId, analysis.nextState);
      return { notificationCount: result.succeeded };
    } catch (error) {
      console.error('Update check notification dispatch threw', error);
      return { notificationCount: 0 };
    }
  }

  private dispatchNotificationPayload(payload: NotificationPayload) {
    return this.notifications.dispatchPayload(payload);
  }

  private async notifyDisplayData(
    input: DispatchUpdateResultNotificationsInput,
    value: { userId: string; data: WatchingUpdateNotificationPayloadData },
  ): Promise<void> {
    if (!input.onNotificationData) return;
    try {
      await input.onNotificationData(value);
    } catch (error) {
      console.error('Update check notification data callback failed', error);
    }
  }
}

export function toNotificationCandidate(result: UpdateResult) {
  const fromEpisode = result.metadata?.baselineEpisode;
  const toEpisode = result.metadata?.effectiveLatestEpisode;
  return Number.isFinite(fromEpisode) && Number.isFinite(toEpisode)
    ? [
        {
          followId: result.followId,
          title: result.title,
          fromEpisode,
          toEpisode,
          hasUpdate: result.hasUpdate,
        },
      ]
    : [];
}

export async function resolveUpdateResultNotificationTimezone(
  userId: string,
  checkedAt: number,
): Promise<string> {
  try {
    const [settings, adminConfig] = await Promise.all([
      systemConfigRepository.getUpdateCheckConfig(),
      getConfig(),
    ]);
    const user = adminConfig.UserConfig.Users.find(
      (candidate) => candidate.username === userId,
    );
    const schedule = resolveUserWatchingUpdateSchedule({
      username: userId,
      userUpdateCheckBackendEnabled:
        userId === process.env.USERNAME ||
        user?.updateCheckBackendEnabled === true,
      isOwner: userId === process.env.USERNAME || user?.role === 'owner',
      systemConfig: settings,
      userConfig: user?.watchingUpdateConfig,
      from: new Date(checkedAt),
    });
    return schedule.source.timezone === 'default'
      ? normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
      : schedule.timezone;
  } catch {
    return 'UTC';
  }
}

function formatNotificationTime(timestamp: number, timezone: string): string {
  return timezoneService.format(timestamp, timezone);
}

export const updateResultNotificationDispatcher =
  new UpdateResultNotificationDispatcher();
