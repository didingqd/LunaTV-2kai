export interface NotificationMessage {
  userId: string;
  type: string;
  title: string;
  content: string;
  createdAt: number;
  payload?: Record<string, unknown>;
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
