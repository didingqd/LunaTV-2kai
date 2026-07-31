// Phase 2 notification refactor: the registry is the only lookup table for
// notification provider discovery.  NotificationManager and settings services use
// this registry to resolve a channel type, keeping concrete providers out of
// update-check and other business flows.

import type { NotificationProvider } from './notification-provider';

export interface NotificationProviderMetadata {
  type: string;
  name: string;
  configSchema: ReturnType<NotificationProvider['getConfigSchema']>;
}

export class NotificationProviderRegistry {
  private readonly providers = new Map<string, NotificationProvider>();

  register(provider: NotificationProvider): void {
    if (this.providers.has(provider.type)) {
      throw new Error(
        `NOTIFICATION_PROVIDER_ALREADY_REGISTERED:${provider.type}`,
      );
    }
    this.providers.set(provider.type, provider);
  }

  get(type: string): NotificationProvider | null {
    return this.providers.get(type) ?? null;
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  list(): NotificationProviderMetadata[] {
    return Array.from(this.providers.values()).map((provider) => ({
      type: provider.type,
      name: provider.getDisplayName(),
      configSchema: provider.getConfigSchema(),
    }));
  }
}

export const notificationProviderRegistry = new NotificationProviderRegistry();
