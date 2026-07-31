import { Bell, Building2, Inbox, type LucideIcon } from 'lucide-react';

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

// UI 阶段新增的前端 Provider 元数据注册表：页面只消费这里的 displayName、icon、schema 和能力，
// 避免在 NotificationSettingsPage 中散落 inbox / wechat_work 的字段判断。后续接入 Telegram、Webhook
// 或 Email 时，只需要补充一个 ProviderMeta，卡片、添加、编辑和事件订阅 UI 会自动复用同一套渲染流程。
export const NOTIFICATION_PROVIDER_METAS: NotificationProviderMeta[] = [
  {
    type: 'inbox',
    displayName: '站内通知',
    description: '在 LunaTV 通知中心接收系统内消息。',
    icon: Inbox,
    defaultName: '站内通知',
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
    displayName: '企业微信',
    description: '通过企业微信群机器人 Webhook 推送外部通知。',
    icon: Building2,
    defaultName: '企业微信',
    defaultConfig: { webhookUrl: '' },
    configSchema: {
      fields: [
        {
          key: 'webhookUrl',
          type: 'url',
          label: 'Webhook 地址',
          required: true,
          placeholder:
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
          description: '保存后页面只显示脱敏地址；如需修改请粘贴完整 Webhook。',
        },
      ],
    },
    capabilities: {
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canTest: true,
      canToggle: true,
    },
  },
];

export const NOTIFICATION_EVENT_METAS: NotificationEventMeta[] = [
  {
    type: 'watching.update_found',
    label: '追更发现更新',
    description: '追更检查发现新剧集或新上映内容时通知。',
  },
  {
    type: 'watching.update_failed',
    label: '更新检查失败',
    description: '追更检查遇到资源站异常、解析失败或网络错误时通知。',
  },
  {
    type: 'scheduler.failed',
    label: '调度失败',
    description: '后台调度任务运行失败时通知。',
  },
  {
    type: 'system.error',
    label: '系统错误',
    description: '系统级异常或后续新增错误事件通知。',
  },
];

export const DEFAULT_NOTIFICATION_SUBSCRIBED_EVENTS = [
  'watching.update_found',
  'watching.update_failed',
];

const UNKNOWN_PROVIDER_META: NotificationProviderMeta = {
  type: 'unknown',
  displayName: '未知通知方式',
  description: '该通知方式缺少前端元数据，暂时只能显示基础信息。',
  icon: Bell,
  defaultName: '通知方式',
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
  return (
    PROVIDER_META_MAP.get(type) ?? {
      ...UNKNOWN_PROVIDER_META,
      type,
    }
  );
}

export function getCreatableNotificationProviderMetas(): NotificationProviderMeta[] {
  return NOTIFICATION_PROVIDER_METAS.filter(
    (provider) => provider.capabilities.canCreate,
  );
}
