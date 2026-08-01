import {
  APPLICATION_NOTIFICATION_EVENT_METAS,
  DEFAULT_APPLICATION_NOTIFICATION_SUBSCRIBED_EVENTS,
  NOTIFICATION_TEST_EVENT_TYPE,
} from './notification-event-definitions';
import { notificationEventRegistry } from './notification/notification-event-metadata';
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
  registered = true;
}

registerApplicationNotificationEvents();

export const NOTIFICATION_EVENT_METAS = APPLICATION_NOTIFICATION_EVENT_METAS;
export const DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS =
  DEFAULT_APPLICATION_NOTIFICATION_SUBSCRIBED_EVENTS;

export { NOTIFICATION_TEST_EVENT_TYPE };
