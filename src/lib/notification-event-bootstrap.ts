import { notificationEventRegistry } from './notification/notification-event-metadata';
import {
  APPLICATION_NOTIFICATION_EVENT_METAS,
  DEFAULT_APPLICATION_NOTIFICATION_SUBSCRIBED_EVENTS,
  NOTIFICATION_TEST_EVENT_TYPE,
} from './notification-event-definitions';
import { registerWatchingUpdateNotificationBuilder } from './watching-update-notification-builder';
import {
  WATCHING_UPDATE_FAILED_EVENT_TYPE,
  WATCHING_UPDATE_FOUND_EVENT_TYPE,
} from './watching-update-notification-events';

let registered = false;

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function registerApplicationNotificationEvents(): void {
  if (registered) return;
  notificationEventRegistry.registerMany(APPLICATION_NOTIFICATION_EVENT_METAS);
  notificationEventRegistry.registerLegacySubscriptionReader((settings) => {
    const patches: Array<{ eventType: string; enabled: boolean }> = [];
    const foundEnabled = readBoolean(settings.watchingUpdateFoundEnabled);
    const failedEnabled = readBoolean(settings.watchingUpdateFailedEnabled);
    if (foundEnabled !== null) {
      patches.push({
        eventType: WATCHING_UPDATE_FOUND_EVENT_TYPE,
        enabled: foundEnabled,
      });
    }
    if (failedEnabled !== null) {
      patches.push({
        eventType: WATCHING_UPDATE_FAILED_EVENT_TYPE,
        enabled: failedEnabled,
      });
    }
    return patches;
  });
  // 修改点：同步注册追更事件的内容模板变量解析器（幂等），
  // 保证通知设置 API / 编辑弹窗在无调度器的请求里也能拿到模板变量元数据
  registerWatchingUpdateNotificationBuilder();
  registered = true;
}

registerApplicationNotificationEvents();

export const NOTIFICATION_EVENT_METAS = APPLICATION_NOTIFICATION_EVENT_METAS;
export const DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS =
  DEFAULT_APPLICATION_NOTIFICATION_SUBSCRIBED_EVENTS;

export { NOTIFICATION_TEST_EVENT_TYPE };
