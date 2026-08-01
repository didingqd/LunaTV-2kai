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

export interface ChannelFormState {
  mode: 'create' | 'edit';
  channelId?: string;
  providerType: string;
  name: string;
  subscribedEvents: string[];
  config: Record<string, string>;
  originalConfig: Record<string, string>;
}

export type ChannelModalStep = 'provider' | 'config';
