import {
  notificationBuilderRegistry,
  type NotificationBuilder,
} from './notification/notification-builder';
import type {
  NotificationMessage,
  NotificationPayload,
} from './notification/notification-types';
import { formatDateTime } from './time';
import type {
  UpdateDiffAnalysis,
  WatchingUpdateChange,
} from './watching-update-notification-types';

export const WATCHING_UPDATE_FOUND_EVENT_TYPE = 'watching.update_found';
export const WATCHING_UPDATE_FAILED_EVENT_TYPE = 'watching.update_failed';

export interface WatchingUpdateNotificationContent {
  title: string;
  content: string;
  displayTime: string;
}

export interface WatchingUpdateNotificationPayloadData {
  title: string;
  newUpdates: WatchingUpdateChange[];
  pendingUpdates: WatchingUpdateChange[];
  checkedAt: number;
  timezone: string;
  displayTime: string;
}

export interface WatchingUpdateFailedNotificationPayloadData {
  title: string;
  message: string;
  error: string;
  source: string;
  displayTime: string;
  failedAt: number;
  resourceId?: string;
  taskSource?: string;
  taskId?: string;
  followId?: string;
}

export type WatchingUpdateNotificationPayload = NotificationPayload & {
  type: typeof WATCHING_UPDATE_FOUND_EVENT_TYPE;
  targetUser: string;
  data: WatchingUpdateNotificationPayloadData;
};

export type WatchingUpdateFailedNotificationPayload = NotificationPayload & {
  type: typeof WATCHING_UPDATE_FAILED_EVENT_TYPE;
  targetUser: string;
  data: WatchingUpdateFailedNotificationPayloadData;
};

export function createWatchingUpdateFoundPayload(input: {
  userId: string;
  newUpdates: WatchingUpdateChange[];
  pendingUpdates: WatchingUpdateChange[];
  checkedAt: number;
  timezone: string;
  displayTime: string;
}): WatchingUpdateNotificationPayload {
  return {
    type: WATCHING_UPDATE_FOUND_EVENT_TYPE,
    targetUser: input.userId,
    occurredAt: input.checkedAt,
    data: {
      title: '更新提醒',
      newUpdates: input.newUpdates,
      pendingUpdates: input.pendingUpdates,
      checkedAt: input.checkedAt,
      timezone: input.timezone,
      displayTime: input.displayTime,
    },
    metadata: {
      source: 'update-check',
      checkedAt: input.checkedAt,
      timezone: input.timezone,
      displayTime: input.displayTime,
    },
  };
}

export function createWatchingUpdateFailedPayload(input: {
  userId: string;
  title: string;
  message: string;
  error: string;
  source: string;
  timestamp: number;
  displayTime: string;
  metadata?: Record<string, unknown>;
}): WatchingUpdateFailedNotificationPayload {
  const metadata = input.metadata ?? {};
  return {
    type: WATCHING_UPDATE_FAILED_EVENT_TYPE,
    targetUser: input.userId,
    occurredAt: input.timestamp,
    data: {
      title: input.title,
      message: input.message,
      error: input.error,
      source: input.source,
      displayTime: input.displayTime,
      failedAt:
        typeof metadata.failedAt === 'number'
          ? metadata.failedAt
          : input.timestamp,
      resourceId:
        typeof metadata.resourceId === 'string'
          ? metadata.resourceId
          : undefined,
      taskSource:
        typeof metadata.taskSource === 'string'
          ? metadata.taskSource
          : undefined,
      taskId: typeof metadata.taskId === 'string' ? metadata.taskId : undefined,
      followId:
        typeof metadata.followId === 'string' ? metadata.followId : undefined,
    },
    metadata,
  };
}

function isWatchingUpdatePayload(
  value: unknown,
): value is WatchingUpdateNotificationPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as NotificationPayload).type === WATCHING_UPDATE_FOUND_EVENT_TYPE
  );
}

export class WatchingUpdateNotificationBuilder implements NotificationBuilder<WatchingUpdateNotificationPayload> {
  build(payload: WatchingUpdateNotificationPayload): NotificationMessage;
  build(
    analysis: Pick<UpdateDiffAnalysis, 'newUpdates' | 'pendingUpdates'>,
    checkedAt: number,
    timezone: string,
  ): WatchingUpdateNotificationContent | null;
  build(
    payloadOrAnalysis:
      | WatchingUpdateNotificationPayload
      | Pick<UpdateDiffAnalysis, 'newUpdates' | 'pendingUpdates'>,
    checkedAt?: number,
    timezone?: string,
  ): NotificationMessage | WatchingUpdateNotificationContent | null {
    if (isWatchingUpdatePayload(payloadOrAnalysis)) {
      const content = this.buildContent(
        {
          newUpdates: payloadOrAnalysis.data.newUpdates,
          pendingUpdates: payloadOrAnalysis.data.pendingUpdates,
        },
        payloadOrAnalysis.data.checkedAt,
        payloadOrAnalysis.data.timezone,
        payloadOrAnalysis.data.displayTime,
      );
      if (!content) {
        return {
          userId: payloadOrAnalysis.targetUser,
          type: payloadOrAnalysis.type,
          title: payloadOrAnalysis.data.title,
          body: '',
          content: '',
          createdAt: payloadOrAnalysis.data.checkedAt,
          payload: { ...payloadOrAnalysis.data },
          metadata: payloadOrAnalysis.metadata,
        };
      }
      return {
        userId: payloadOrAnalysis.targetUser,
        type: payloadOrAnalysis.type,
        title: content.title,
        body: content.content,
        content: content.content,
        level: 'success',
        createdAt: payloadOrAnalysis.data.checkedAt,
        payload: {
          ...payloadOrAnalysis.data,
          eventType: payloadOrAnalysis.type,
        },
        metadata: payloadOrAnalysis.metadata,
      };
    }

    if (checkedAt === undefined || timezone === undefined) {
      throw new Error('INVALID_WATCHING_UPDATE_NOTIFICATION_INPUT');
    }
    return this.buildContent(payloadOrAnalysis, checkedAt, timezone);
  }

  private buildContent(
    analysis: Pick<UpdateDiffAnalysis, 'newUpdates' | 'pendingUpdates'>,
    checkedAt: number,
    timezone: string,
    displayTime = formatDateTime(checkedAt, timezone),
  ): WatchingUpdateNotificationContent | null {
    if (analysis.newUpdates.length === 0) return null;

    const sections = ['更新提醒', '', '【新更新】', ''];
    this.appendEpisodeChanges(sections, analysis.newUpdates);

    if (analysis.pendingUpdates.length > 0) {
      sections.push('', '【待观看更新】', '');
      this.appendEpisodeChanges(sections, analysis.pendingUpdates);
    }

    sections.push('', '检查时间：', displayTime);

    return {
      title: '更新提醒',
      content: sections.join('\n'),
      displayTime,
    };
  }

  private appendEpisodeChanges(
    sections: string[],
    items: Array<{ title: string; fromEpisode: number; toEpisode: number }>,
  ): void {
    items.forEach((item, index) => {
      if (index > 0) sections.push('');
      sections.push(item.title, `${item.fromEpisode}集 → ${item.toEpisode}集`);
    });
  }
}

export const watchingUpdateNotificationBuilder =
  new WatchingUpdateNotificationBuilder();

let watchingUpdateNotificationBuilderRegistered = false;

export function registerWatchingUpdateNotificationBuilder(): void {
  if (watchingUpdateNotificationBuilderRegistered) return;
  notificationBuilderRegistry.register(
    WATCHING_UPDATE_FOUND_EVENT_TYPE,
    watchingUpdateNotificationBuilder,
  );
  watchingUpdateNotificationBuilderRegistered = true;
}
