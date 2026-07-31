import type { NotificationMessage } from './notification-types';

export interface NotificationChannel {
  readonly name: string;
  send(message: NotificationMessage): Promise<void>;
}
