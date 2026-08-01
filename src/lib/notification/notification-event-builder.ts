import type { NotificationEvent } from './notification-types';
import { NotificationEventType } from './notification-types';

interface WatchingUpdateFoundInput {
  userId: string;
  title: string;
  message: string;
  source: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

interface WatchingUpdateFailedInput {
  userId: string;
  title: string;
  message: string;
  error: string;
  source: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

interface SchedulerFailedInput {
  userId: string;
  taskName: string;
  error: string;
  timestamp: number;
}

export function createWatchingUpdateFoundEvent(
  input: WatchingUpdateFoundInput,
): NotificationEvent {
  return {
    id: '',
    type: NotificationEventType.WATCHING_UPDATE_FOUND,
    userId: input.userId,
    data: {
      title: input.title,
      message: input.message,
      content: input.message,
      source: input.source,
      metadata: input.metadata,
      timestamp: input.timestamp,
    },
    createdAt: input.timestamp,
  };
}

export function createWatchingUpdateFailedEvent(
  input: WatchingUpdateFailedInput,
): NotificationEvent {
  return {
    id: '',
    type: NotificationEventType.WATCHING_UPDATE_FAILED,
    userId: input.userId,
    data: {
      title: input.title,
      message: input.message,
      content: input.message,
      error: input.error,
      source: input.source,
      metadata: input.metadata,
      timestamp: input.timestamp,
    },
    createdAt: input.timestamp,
  };
}

export function createSchedulerFailedEvent(
  input: SchedulerFailedInput,
): NotificationEvent {
  return {
    id: '',
    type: NotificationEventType.SCHEDULER_FAILED,
    userId: input.userId,
    data: {
      taskName: input.taskName,
      error: input.error,
      timestamp: input.timestamp,
      title: '调度失败',
      message: `${input.taskName} 执行失败：${input.error}`,
      content: `${input.taskName} 执行失败：${input.error}`,
    },
    createdAt: input.timestamp,
  };
}
