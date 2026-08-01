// Phase 2 notification refactor: register built-in providers once at module load.
// The guard keeps Next.js/Jest module reloads from double-registering providers
// while still allowing future providers to be added by registration, not by
// hard-coded dispatch branches.

import { notificationProviderRegistry } from './notification-provider-registry';
import { barkNotificationProvider } from './providers/bark-notification-provider';
import { inboxNotificationProvider } from './providers/inbox-notification-provider';
import { pushPlusNotificationProvider } from './providers/pushplus-notification-provider';
import { resendNotificationProvider } from './providers/resend-notification-provider';
import { serverChan3NotificationProvider } from './providers/serverchan3-notification-provider';
import {
  schemaOnlyNotificationProviderTypes,
  schemaOnlyNotificationProviders,
} from './providers/schema-only-notification-providers';
import { telegramNotificationProvider } from './providers/telegram-notification-provider';
import { webhookNotificationProvider } from './providers/webhook-notification-provider';
import { wechatWorkNotificationProvider } from './providers/wechat-work-notification-provider';

const registeredProviderTypes = new Set<string>();

export function registerDefaultNotificationProviders(): void {
  for (const provider of [
    inboxNotificationProvider,
    wechatWorkNotificationProvider,
    webhookNotificationProvider,
    telegramNotificationProvider,
    barkNotificationProvider,
    pushPlusNotificationProvider,
    serverChan3NotificationProvider,
    resendNotificationProvider,
    ...schemaOnlyNotificationProviders,
  ]) {
    if (
      registeredProviderTypes.has(provider.type) ||
      notificationProviderRegistry.has(provider.type)
    ) {
      continue;
    }
    notificationProviderRegistry.register(provider, {
      // Schema-only providers validate and persist settings, but they must stay
      // visibly preview-only until a real delivery adapter is registered.
      canSend: !schemaOnlyNotificationProviderTypes.has(provider.type),
      // Inbox is provisioned by default and is not a user-created external
      // channel, so settings should not expose create/delete/test controls.
      ...(provider.type === 'inbox'
        ? { canCreate: false, canDelete: false, canTest: false }
        : {}),
    });
    registeredProviderTypes.add(provider.type);
  }
}

registerDefaultNotificationProviders();

export { notificationProviderRegistry };
