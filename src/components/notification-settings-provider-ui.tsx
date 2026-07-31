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
  configSchema: NotificationProviderConfigSchemaMeta;
  capabilities: NotificationProviderCapabilitiesMeta;
  deliveryStatus: 'active' | 'preview';
}

export interface NotificationProviderMeta
  extends BackendNotificationProviderMeta {
  description: string;
  icon: LucideIcon;
  defaultName: string;
  defaultConfig: Record<string, string>;
}

interface NotificationProviderPresentationMeta {
  type: string;
  description: string;
  icon: LucideIcon;
  defaultName: string;
}

export interface NotificationEventMeta {
  type: string;
  label: string;
  description: string;
}

// UI metadata is intentionally presentation-only. Provider type, form schema,
// validation and capability state are merged from /api/user/notification-providers
// so a newly styled provider can never be created before backend registration.
export const NOTIFICATION_PROVIDER_UI_METAS: NotificationProviderPresentationMeta[] =
  [
    {
      type: 'inbox',
      description:
        '\u5728 LunaTV \u7ad9\u5185\u901a\u77e5\u4e2d\u5fc3\u63a5\u6536\u6d88\u606f\u3002',
      icon: Inbox,
      defaultName: '\u7ad9\u5185\u901a\u77e5',
    },
    {
      type: 'wechat_work',
      description:
        '\u53d1\u9001\u901a\u77e5\u5230\u4f01\u4e1a\u5fae\u4fe1\u7fa4\u673a\u5668\u4eba\u3002',
      icon: Building2,
      defaultName: '\u4f01\u4e1a\u5fae\u4fe1',
    },
    {
      type: 'telegram',
      description: 'Telegram Bot \u63a8\u9001\u3002',
      icon: Send,
      defaultName: 'Telegram',
    },
    {
      type: 'bark',
      description: 'Bark iOS \u63a8\u9001\u3002',
      icon: Smartphone,
      defaultName: 'Bark',
    },
    {
      type: 'pushplus',
      description: 'PushPlus \u63a8\u9001\u3002',
      icon: MessageCircle,
      defaultName: 'PushPlus',
    },
    {
      type: 'dingtalk',
      description: '\u9489\u9489\u7fa4\u673a\u5668\u4eba\u63a8\u9001\u3002',
      icon: Bot,
      defaultName: '\u9489\u9489',
    },
    {
      type: 'lark',
      description: '\u98de\u4e66\u7fa4\u673a\u5668\u4eba\u63a8\u9001\u3002',
      icon: MessageSquare,
      defaultName: '\u98de\u4e66',
    },
    {
      type: 'wecom',
      description:
        '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba Key \u63a8\u9001\u3002',
      icon: Building2,
      defaultName: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba',
    },
    {
      type: 'serverchan3',
      description: 'Server\u9171 Turbo \u63a8\u9001\u3002',
      icon: BellRing,
      defaultName: 'Server\u9171',
    },
    {
      type: 'notifyx',
      description: 'NotifyX \u805a\u5408\u63a8\u9001\u3002',
      icon: Bell,
      defaultName: 'NotifyX',
    },
    {
      type: 'resend',
      description: '\u90ae\u4ef6\u901a\u77e5\u3002',
      icon: Mail,
      defaultName: 'Email',
    },
    {
      type: 'webhook',
      description: 'HTTP POST \u63a8\u9001\u3002',
      icon: Link,
      defaultName: 'Webhook',
    },
    {
      type: 'gotify',
      description: 'Gotify \u81ea\u6258\u7ba1\u63a8\u9001\u3002',
      icon: Bell,
      defaultName: 'Gotify',
    },
    {
      type: 'ntfy',
      description: 'ntfy \u4e3b\u9898\u63a8\u9001\u3002',
      icon: Radio,
      defaultName: 'Ntfy',
    },
  ];

const PROVIDER_PRESENTATION_MAP = new Map(
  NOTIFICATION_PROVIDER_UI_METAS.map((provider) => [provider.type, provider]),
);

function getPresentationMeta(
  type: string,
): NotificationProviderPresentationMeta {
  return (
    PROVIDER_PRESENTATION_MAP.get(type) ?? {
      type,
      description:
        '\u6b64\u901a\u77e5\u6e20\u9053\u6682\u672a\u63d0\u4f9b\u989d\u5916\u5c55\u793a\u4fe1\u606f\u3002',
      icon: Bell,
      defaultName: '\u901a\u77e5\u6e20\u9053',
    }
  );
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
  const presentation = getPresentationMeta(provider.type);
  return {
    ...provider,
    description: provider.description || presentation.description,
    icon: presentation.icon,
    defaultName: presentation.defaultName || provider.displayName,
    defaultConfig: buildDefaultConfig(provider.configSchema),
  };
}

export const NOTIFICATION_EVENT_METAS: NotificationEventMeta[] = [
  {
    type: 'watching.update_found',
    label: '\u8ffd\u66f4\u66f4\u65b0',
    description:
      '\u5173\u6ce8\u7684\u5f71\u89c6\u5185\u5bb9\u53d1\u73b0\u65b0\u96c6\u6216\u65b0\u5b63\u65f6\u901a\u77e5\u3002',
  },
  {
    type: 'watching.update_failed',
    label: '\u66f4\u65b0\u5931\u8d25',
    description:
      '\u8ffd\u66f4\u68c0\u67e5\u6216\u66f4\u65b0\u8fc7\u7a0b\u5931\u8d25\u65f6\u901a\u77e5\u3002',
  },
  {
    type: 'scheduler.failed',
    label: '\u8c03\u5ea6\u5931\u8d25',
    description:
      '\u540e\u53f0\u5b9a\u65f6\u4efb\u52a1\u6267\u884c\u5931\u8d25\u65f6\u901a\u77e5\u3002',
  },
  {
    type: 'system.error',
    label: '\u7cfb\u7edf\u9519\u8bef',
    description:
      '\u7cfb\u7edf\u7ea7\u9519\u8bef\u6216\u6d4b\u8bd5\u901a\u77e5\u573a\u666f\u3002',
  },
];

export const DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS = [
  'watching.update_found',
  'watching.update_failed',
];
