// Phase 2 notification refactor: register built-in providers once at module load.
// The guard keeps Next.js/Jest module reloads from double-registering providers
// while still allowing future providers to be added by registration, not by
// hard-coded dispatch branches.

import { notificationProviderRegistry } from './notification-provider-registry';
import { inboxNotificationProvider } from './providers/inbox-notification-provider';
import { wechatWorkNotificationProvider } from './providers/wechat-work-notification-provider';

const registeredProviderTypes = new Set<string>();

export function registerDefaultNotificationProviders(): void {
  for (const provider of [
    inboxNotificationProvider,
    wechatWorkNotificationProvider,
  ]) {
    if (
      registeredProviderTypes.has(provider.type) ||
      notificationProviderRegistry.has(provider.type)
    )
      continue;
    notificationProviderRegistry.register(provider);
    registeredProviderTypes.add(provider.type);
  }
}

registerDefaultNotificationProviders();

export { notificationProviderRegistry };
