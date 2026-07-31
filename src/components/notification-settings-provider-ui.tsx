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
  return {
    ...provider,
    icon: resolveNotificationProviderIcon(provider.icon),
    iconName: provider.icon,
    defaultConfig: buildDefaultConfig(provider.configSchema),
  };
}
