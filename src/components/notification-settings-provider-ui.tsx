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
}
export interface NotificationProviderMeta {
  type: string;
  displayName: string;
  description: string;
  icon: LucideIcon;
  defaultName: string;
  defaultConfig: Record<string, string>;
  configSchema: NotificationProviderConfigSchemaMeta;
  capabilities: NotificationProviderCapabilitiesMeta;
}
export interface NotificationEventMeta {
  type: string;
  label: string;
  description: string;
}

const creatableCapabilities: NotificationProviderCapabilitiesMeta = {
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canTest: true,
  canToggle: true,
};
function field(
  key: string,
  label: string,
  options: Partial<
    Omit<NotificationProviderConfigFieldMeta, 'key' | 'label'>
  > = {},
): NotificationProviderConfigFieldMeta {
  return { key, label, type: 'text', ...options };
}

export const NOTIFICATION_PROVIDER_METAS: NotificationProviderMeta[] = [
  {
    type: 'inbox',
    displayName: '\u7ad9\u5185\u901a\u77e5',
    description:
      '\u5728 LunaTV \u7ad9\u5185\u901a\u77e5\u4e2d\u5fc3\u63a5\u6536\u6d88\u606f\u3002',
    icon: Inbox,
    defaultName: '\u7ad9\u5185\u901a\u77e5',
    defaultConfig: {},
    configSchema: { fields: [] },
    capabilities: {
      canCreate: false,
      canEdit: true,
      canDelete: false,
      canTest: false,
      canToggle: true,
    },
  },
  {
    type: 'wechat_work',
    displayName: '\u4f01\u4e1a\u5fae\u4fe1',
    description:
      '\u53d1\u9001\u901a\u77e5\u5230\u4f01\u4e1a\u5fae\u4fe1\u7fa4\u673a\u5668\u4eba\u3002',
    icon: Building2,
    defaultName: '\u4f01\u4e1a\u5fae\u4fe1',
    defaultConfig: { webhookUrl: '' },
    configSchema: {
      fields: [
        field('webhookUrl', 'Webhook \u5730\u5740', {
          type: 'url',
          required: true,
          placeholder:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
          description:
            '\u4f01\u4e1a\u5fae\u4fe1\u7fa4\u673a\u5668\u4eba\u63d0\u4f9b\u7684 Webhook \u5730\u5740\u3002',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'telegram',
    displayName: 'Telegram',
    description: 'Telegram Bot \u63a8\u9001\u3002',
    icon: Send,
    defaultName: 'Telegram',
    defaultConfig: { token: '', chatId: '', apiServer: '' },
    configSchema: {
      fields: [
        field('token', 'Bot Token', {
          type: 'password',
          required: true,
          placeholder: '123456:AA...',
        }),
        field('chatId', 'Chat ID', {
          required: true,
          placeholder: '-1001234567890',
        }),
        field('apiServer', 'API Server\uff08\u53ef\u9009\uff09', {
          type: 'url',
          placeholder: 'https://api.telegram.org',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'bark',
    displayName: 'Bark',
    description: 'Bark iOS \u63a8\u9001\u3002',
    icon: Smartphone,
    defaultName: 'Bark',
    defaultConfig: { server: '', key: '' },
    configSchema: {
      fields: [
        field(
          'server',
          '\u670d\u52a1\u5668\u5730\u5740\uff08\u53ef\u9009\uff09',
          { type: 'url', placeholder: 'https://api.day.app' },
        ),
        field('key', '\u8bbe\u5907 Key', {
          type: 'password',
          required: true,
          placeholder: 'Bark \u8bbe\u5907 Key',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'pushplus',
    displayName: 'PushPlus',
    description: 'PushPlus \u63a8\u9001\u3002',
    icon: MessageCircle,
    defaultName: 'PushPlus',
    defaultConfig: { token: '' },
    configSchema: {
      fields: [
        field('token', 'Token', {
          type: 'password',
          required: true,
          placeholder: 'PushPlus Token',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'dingtalk',
    displayName: '\u9489\u9489',
    description: '\u9489\u9489\u7fa4\u673a\u5668\u4eba\u63a8\u9001\u3002',
    icon: Bot,
    defaultName: '\u9489\u9489',
    defaultConfig: { token: '', secret: '' },
    configSchema: {
      fields: [
        field('token', 'Access Token', {
          type: 'password',
          required: true,
          placeholder: 'access_token',
        }),
        field('secret', 'Secret\uff08\u53ef\u9009\uff09', {
          type: 'password',
          placeholder: 'SEC...',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'lark',
    displayName: '\u98de\u4e66',
    description: '\u98de\u4e66\u7fa4\u673a\u5668\u4eba\u63a8\u9001\u3002',
    icon: MessageSquare,
    defaultName: '\u98de\u4e66',
    defaultConfig: { token: '', secret: '' },
    configSchema: {
      fields: [
        field('token', 'Webhook Token', {
          type: 'password',
          required: true,
          placeholder: 'Webhook token',
        }),
        field('secret', '\u7b7e\u540d\u5bc6\u94a5\uff08\u53ef\u9009\uff09', {
          type: 'password',
          placeholder: 'Sign Key',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'wecom',
    displayName: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba',
    description:
      '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba Key \u63a8\u9001\u3002',
    icon: Building2,
    defaultName: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba',
    defaultConfig: { token: '' },
    configSchema: {
      fields: [
        field('token', '\u673a\u5668\u4eba Key', {
          type: 'password',
          required: true,
          placeholder: 'Key',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'serverchan3',
    displayName: 'Server\u91713',
    description: 'Server\u9171 Turbo \u63a8\u9001\u3002',
    icon: BellRing,
    defaultName: 'Server\u9171',
    defaultConfig: { uid: '', key: '' },
    configSchema: {
      fields: [
        field('uid', '\u7528\u6237 UID', {
          required: true,
          placeholder: 'Server\u9171 UID',
        }),
        field('key', 'SendKey', {
          type: 'password',
          required: true,
          placeholder: 'SendKey',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'notifyx',
    displayName: 'NotifyX',
    description: 'NotifyX \u805a\u5408\u63a8\u9001\u3002',
    icon: Bell,
    defaultName: 'NotifyX',
    defaultConfig: { apiKey: '' },
    configSchema: {
      fields: [
        field('apiKey', 'API Key', {
          type: 'password',
          required: true,
          placeholder: 'NotifyX API Key',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'resend',
    displayName: 'Email',
    description: '\u90ae\u4ef6\u901a\u77e5\u3002',
    icon: Mail,
    defaultName: 'Email',
    defaultConfig: { apiKey: '', from: '', to: '' },
    configSchema: {
      fields: [
        field('apiKey', 'API Key', {
          type: 'password',
          required: true,
          placeholder: 're_...',
        }),
        field('from', '\u53d1\u4ef6\u4eba', {
          required: true,
          placeholder: 'notify@example.com',
        }),
        field('to', '\u6536\u4ef6\u4eba', {
          required: true,
          placeholder: 'you@example.com',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'webhook',
    displayName: 'Webhook',
    description: 'HTTP POST \u63a8\u9001\u3002',
    icon: Link,
    defaultName: 'Webhook',
    defaultConfig: { url: '', headers: '', body: '' },
    configSchema: {
      fields: [
        field('url', 'URL', {
          type: 'url',
          required: true,
          placeholder: 'https://example.com/webhook',
        }),
        field('headers', 'Headers\uff08\u53ef\u9009\uff09', {
          placeholder: 'JSON \u8bf7\u6c42\u5934',
        }),
        field('body', 'Body \u6a21\u677f\uff08\u53ef\u9009\uff09', {
          placeholder: '{title} {body}',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'gotify',
    displayName: 'Gotify',
    description: 'Gotify \u81ea\u6258\u7ba1\u63a8\u9001\u3002',
    icon: Bell,
    defaultName: 'Gotify',
    defaultConfig: { server: '', token: '' },
    configSchema: {
      fields: [
        field('server', '\u670d\u52a1\u5668\u5730\u5740', {
          type: 'url',
          required: true,
          placeholder: 'https://gotify.example.com',
        }),
        field('token', '\u5e94\u7528 Token', {
          type: 'password',
          required: true,
          placeholder: 'Application Token',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
  {
    type: 'ntfy',
    displayName: 'Ntfy',
    description: 'ntfy \u4e3b\u9898\u63a8\u9001\u3002',
    icon: Radio,
    defaultName: 'Ntfy',
    defaultConfig: { server: '', topic: '', token: '' },
    configSchema: {
      fields: [
        field(
          'server',
          '\u670d\u52a1\u5668\u5730\u5740\uff08\u53ef\u9009\uff09',
          { type: 'url', placeholder: 'https://ntfy.sh' },
        ),
        field('topic', 'Topic', { required: true, placeholder: 'my-topic' }),
        field('token', 'Token\uff08\u53ef\u9009\uff09', {
          type: 'password',
          placeholder: 'tk_...',
        }),
      ],
    },
    capabilities: creatableCapabilities,
  },
];

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

const UNKNOWN_PROVIDER_META: NotificationProviderMeta = {
  type: 'unknown',
  displayName: '\u672a\u77e5\u6e20\u9053',
  description:
    '\u6b64\u6e20\u9053\u7c7b\u578b\u5f53\u524d\u6ca1\u6709\u53ef\u7528\u7684\u5c55\u793a\u5143\u6570\u636e\u3002',
  icon: Bell,
  defaultName: '\u901a\u77e5\u6e20\u9053',
  defaultConfig: {},
  configSchema: { fields: [] },
  capabilities: {
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canTest: false,
    canToggle: false,
  },
};
const PROVIDER_META_MAP = new Map(
  NOTIFICATION_PROVIDER_METAS.map((provider) => [provider.type, provider]),
);
export function getNotificationProviderMeta(
  type: string,
): NotificationProviderMeta {
  return PROVIDER_META_MAP.get(type) ?? { ...UNKNOWN_PROVIDER_META, type };
}
export function getCreatableNotificationProviderMetas(): NotificationProviderMeta[] {
  return NOTIFICATION_PROVIDER_METAS.filter(
    (provider) => provider.capabilities.canCreate,
  );
}
