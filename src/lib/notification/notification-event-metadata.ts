import { NotificationEventType } from './notification-types';

export interface NotificationEventMeta {
  type: string;
  label: string;
  description: string;
}

export const NOTIFICATION_EVENT_METAS: NotificationEventMeta[] = [
  {
    type: NotificationEventType.WATCHING_UPDATE_FOUND,
    label: '\u8ffd\u66f4\u66f4\u65b0',
    description:
      '\u5173\u6ce8\u7684\u5f71\u89c6\u5185\u5bb9\u53d1\u73b0\u65b0\u96c6\u6216\u65b0\u5b63\u65f6\u901a\u77e5\u3002',
  },
  {
    type: NotificationEventType.WATCHING_UPDATE_FAILED,
    label: '\u66f4\u65b0\u5931\u8d25',
    description:
      '\u8ffd\u66f4\u68c0\u67e5\u6216\u66f4\u65b0\u8fc7\u7a0b\u5931\u8d25\u65f6\u901a\u77e5\u3002',
  },
  {
    type: NotificationEventType.SCHEDULER_FAILED,
    label: '\u8c03\u5ea6\u5931\u8d25',
    description:
      '\u540e\u53f0\u5b9a\u65f6\u4efb\u52a1\u6267\u884c\u5931\u8d25\u65f6\u901a\u77e5\u3002',
  },
  {
    type: NotificationEventType.SYSTEM_ERROR,
    label: '\u7cfb\u7edf\u9519\u8bef',
    description:
      '\u7cfb\u7edf\u7ea7\u9519\u8bef\u6216\u6d4b\u8bd5\u901a\u77e5\u573a\u666f\u3002',
  },
];

export const DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS = [
  NotificationEventType.WATCHING_UPDATE_FOUND,
  NotificationEventType.WATCHING_UPDATE_FAILED,
];
