export const NotificationMessageType = {
  WATCHING_UPDATE_FOUND: 'WATCHING_UPDATE_FOUND',
  WATCHING_UPDATE_FAILED: 'WATCHING_UPDATE_FAILED',
  SYSTEM: 'SYSTEM',
  MANUAL_TRIGGER: 'MANUAL_TRIGGER',
  DOWNLOAD: 'DOWNLOAD',
} as const;

export type NotificationMessageType =
  (typeof NotificationMessageType)[keyof typeof NotificationMessageType];

export interface NotificationMessage {
  userId: string;
  type: NotificationMessageType;
  title: string;
  content: string;
  createdAt: number;
  payload?: Record<string, unknown>;
}

// Phase 2 notification refactor: domain events use the domain.action naming rule.
// New events can be added as string values without changing provider dispatch logic.
export const NotificationEventType = {
  WATCHING_UPDATE_FOUND: 'watching.update_found',
  WATCHING_UPDATE_FAILED: 'watching.update_failed',
  SCHEDULER_FAILED: 'scheduler.failed',
  SYSTEM_ERROR: 'system.error',
} as const;

export type NotificationEventType =
  (typeof NotificationEventType)[keyof typeof NotificationEventType];

export interface NotificationEvent {
  id: string;
  type: string;
  userId?: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface InboxNotification extends NotificationMessage {
  id: string;
  read: boolean;
  readAt: number | null;
}

export interface NotificationDispatchError {
  channel: string;
  message: string;
}

export interface NotificationDispatchResult {
  success: boolean;
  totalChannels: number;
  succeeded: number;
  failed: number;
  errors: NotificationDispatchError[];
}
