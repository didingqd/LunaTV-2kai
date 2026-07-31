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
