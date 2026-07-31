import type {
  NotificationProviderCapabilities,
  NotificationProviderMetadata,
} from './notification-provider-registry';
import { notificationProviderRegistry } from './notification-provider-bootstrap';
import { getNotificationProviderPresentation } from './notification-provider-presentation';

export type NotificationProviderDeliveryStatus =
  | 'active'
  | 'preview'
  | 'planned';

export interface NotificationProviderApiMeta {
  type: string;
  displayName: string;
  description: string;
  icon: string;
  group?: string;
  sortOrder?: number;
  configSchema: NotificationProviderMetadata['configSchema'];
  capabilities: NotificationProviderCapabilities;
  deliveryStatus: NotificationProviderDeliveryStatus;
}

export function getNotificationProviderDeliveryStatus(
  capabilities: NotificationProviderCapabilities,
): NotificationProviderDeliveryStatus {
  return capabilities.canSend ? 'active' : 'preview';
}

export function buildNotificationProvidersPayload(): {
  providers: NotificationProviderApiMeta[];
} {
  const providers = notificationProviderRegistry
    .list()
    .map((provider): NotificationProviderApiMeta => {
      const presentation = getNotificationProviderPresentation(provider.type);
      return {
        type: provider.type,
        displayName: presentation.displayName || provider.name,
        description: presentation.description,
        icon: presentation.icon,
        group: presentation.group,
        sortOrder: presentation.sortOrder,
        configSchema: provider.configSchema,
        capabilities: provider.capabilities,
        deliveryStatus: getNotificationProviderDeliveryStatus(
          provider.capabilities,
        ),
      };
    });

  providers.sort((left, right) => {
    const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.displayName.localeCompare(right.displayName);
  });

  return { providers };
}
