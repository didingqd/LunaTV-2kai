// Phase 2 notification refactor: the registry is the only lookup table for
// notification provider discovery.  NotificationManager and settings services use
// this registry to resolve a channel type, keeping concrete providers out of
// application notification flows.

import type { NotificationProvider } from './notification-provider';

// Capabilities are registry metadata, not provider interface methods. This keeps
// the delivery contract stable while letting settings UI expose preview
// providers without implying that they can send real notifications.
export interface NotificationProviderCapabilities {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canTest: boolean;
  canToggle: boolean;
  canSend: boolean;
}

const defaultNotificationProviderCapabilities: NotificationProviderCapabilities =
  {
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canTest: true,
    canToggle: true,
    canSend: true,
  };

export interface NotificationProviderMetadata {
  type: string;
  name: string;
  configSchema: ReturnType<NotificationProvider['getConfigSchema']>;
  capabilities: NotificationProviderCapabilities;
}

interface RegisteredNotificationProvider {
  provider: NotificationProvider;
  capabilities: NotificationProviderCapabilities;
}

export class NotificationProviderRegistry {
  private readonly providers = new Map<
    string,
    RegisteredNotificationProvider
  >();

  register(
    provider: NotificationProvider,
    capabilities: Partial<NotificationProviderCapabilities> = {},
  ): void {
    if (this.providers.has(provider.type)) {
      throw new Error(
        `NOTIFICATION_PROVIDER_ALREADY_REGISTERED:${provider.type}`,
      );
    }
    this.providers.set(provider.type, {
      provider,
      capabilities: {
        ...defaultNotificationProviderCapabilities,
        ...capabilities,
      },
    });
  }

  get(type: string): NotificationProvider | null {
    return this.providers.get(type)?.provider ?? null;
  }

  getCapabilities(type: string): NotificationProviderCapabilities | null {
    return this.providers.get(type)?.capabilities ?? null;
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  list(): NotificationProviderMetadata[] {
    return Array.from(this.providers.values()).map(
      ({ provider, capabilities }) => ({
        type: provider.type,
        name: provider.getDisplayName(),
        configSchema: provider.getConfigSchema(),
        capabilities,
      }),
    );
  }
}

export const notificationProviderRegistry = new NotificationProviderRegistry();
