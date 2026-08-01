import {
  Bell,
  BellRing,
  Bot,
  Building2,
  Inbox,
  Link,
  Mail,
  MessageCircle,
  MessageSquare,
  Radio,
  Send,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

export type NotificationConfigFieldType = 'text' | 'password' | 'url';
export type NotificationProviderDeliveryStatus =
  | 'active'
  | 'preview'
  | 'planned';
export type NotificationProviderHealthStatus = 'healthy' | 'warning' | 'failed';

export interface NotificationProviderConfigFieldMeta {
  key: string;
  type: NotificationConfigFieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

export interface NotificationProviderConfigSchemaMeta {
  fields: NotificationProviderConfigFieldMeta[];
}

export interface NotificationProviderCapabilitiesMeta {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canTest: boolean;
  canToggle: boolean;
  canSend: boolean;
}

export interface BackendNotificationProviderMeta {
  type: string;
  displayName: string;
  description: string;
  icon: string;
  group?: string;
  sortOrder?: number;
  configSchema: NotificationProviderConfigSchemaMeta;
  capabilities: NotificationProviderCapabilitiesMeta;
  deliveryStatus: NotificationProviderDeliveryStatus;
  healthStatus?: NotificationProviderHealthStatus;
}

export interface NotificationProviderMeta extends Omit<
  BackendNotificationProviderMeta,
  'icon'
> {
  icon: LucideIcon;
  iconName: string;
  defaultConfig: Record<string, string>;
}

export const NOTIFICATION_DELIVERY_STATUS_LABELS: Record<
  NotificationProviderDeliveryStatus,
  string
> = {
  active: '\u5df2\u652f\u6301',
  preview: '\u9884\u89c8',
  planned: '\u5f00\u53d1\u4e2d',
};

export const NOTIFICATION_HEALTH_STATUS_LABELS: Record<
  NotificationProviderHealthStatus,
  string
> = {
  healthy: '\u5065\u5eb7',
  warning: '\u8b66\u544a',
  failed: '\u5931\u8d25',
};

const NOTIFICATION_PROVIDER_ICON_COMPONENTS: Record<string, LucideIcon> = {
  bell: Bell,
  'bell-ring': BellRing,
  bot: Bot,
  'building-2': Building2,
  inbox: Inbox,
  link: Link,
  mail: Mail,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  radio: Radio,
  send: Send,
  smartphone: Smartphone,
};

const NOTIFICATION_PROVIDER_UI_ALIASES: Record<
  string,
  Pick<NotificationProviderMeta, 'displayName' | 'description'>
> = {
  wecom: {
    displayName: '\u4f01\u4e1a\u5fae\u4fe1',
    description:
      '\u901a\u8fc7\u4f01\u4e1a\u5fae\u4fe1\u914d\u7f6e\u63a8\u9001\u901a\u77e5\u3002',
  },
};

function resolveNotificationProviderIcon(icon: string): LucideIcon {
  return NOTIFICATION_PROVIDER_ICON_COMPONENTS[icon] ?? Bell;
}

function buildDefaultConfig(
  schema: NotificationProviderConfigSchemaMeta,
): Record<string, string> {
  return schema.fields.reduce<Record<string, string>>((config, field) => {
    config[field.key] = '';
    return config;
  }, {});
}

export function mergeNotificationProviderMeta(
  provider: BackendNotificationProviderMeta,
): NotificationProviderMeta {
  const uiAlias = NOTIFICATION_PROVIDER_UI_ALIASES[provider.type];

  return {
    ...provider,
    ...uiAlias,
    icon: resolveNotificationProviderIcon(provider.icon),
    iconName: provider.icon,
    defaultConfig: buildDefaultConfig(provider.configSchema),
  };
}
