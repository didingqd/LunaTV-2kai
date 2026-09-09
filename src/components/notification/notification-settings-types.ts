export interface NotificationChannelConfig {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  subscribedEvents?: string[];
  config: Record<string, unknown>;
}

export interface NotificationSettings {
  version?: number;
  notificationCenterEnabled: boolean;
  inboxEnabled: boolean;
  subscriptions: NotificationSubscription[];
  channels: NotificationChannelConfig[];
  updatedAt?: number;
}

export interface NotificationSubscription {
  eventType: string;
  enabled: boolean;
  channels: string[];
}

// 修改点：模板变量元数据类型统一从 notification-settings-provider-ui 导出（单一来源）
export type {
  NotificationTemplateVariableGroupUI,
  NotificationTemplateVariableMetaUI,
} from '../notification-settings-provider-ui';

export interface ChannelFormState {
  mode: 'create' | 'edit';
  channelId?: string;
  providerType: string;
  name: string;
  subscribedEvents: string[];
  config: Record<string, string>;
  originalConfig: Record<string, string>;
  // 修改点：通知内容模板（空串 = 使用默认模板）与该事件的默认模板，供编辑与恢复默认
  contentTemplate: string;
  defaultContentTemplate: string;
  originalContentTemplate: string;
}

export type ChannelModalStep = 'provider' | 'config';
