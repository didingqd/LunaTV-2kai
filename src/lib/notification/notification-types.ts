export const NotificationMessageType = {
  SYSTEM: 'SYSTEM',
  MANUAL_TRIGGER: 'MANUAL_TRIGGER',
} as const;

export type NotificationMessageType =
  (typeof NotificationMessageType)[keyof typeof NotificationMessageType];

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
  label: string;
  url: string;
}

export interface NotificationAttachment {
  name: string;
  url: string;
  contentType?: string;
}

export interface NotificationPayload {
  id?: string;
  type: string;
  targetUser?: string;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt?: number;
}

export interface NotificationMessage {
  id?: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  content: string;
  level?: NotificationLevel;
  createdAt: number;
  payload?: Record<string, unknown>;
  actions?: NotificationAction[];
  attachments?: NotificationAttachment[];
  metadata?: Record<string, unknown>;
}

/**
 * @deprecated Use NotificationPayload.type strings registered by the owning
 * domain through the event registry.
 */
export const NotificationEventType = {
  SYSTEM_ERROR: 'system.error',
} as const;

export type NotificationEventType =
  (typeof NotificationEventType)[keyof typeof NotificationEventType];

/**
 * @deprecated Use NotificationPayload.
 */
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
