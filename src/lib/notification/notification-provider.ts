// Phase 2 notification refactor: this file defines the provider boundary used by
// NotificationManager.  Channels expose send/test/validation/schema through this
// interface so API routes and UI can discover supported channel capabilities from
// providers instead of adding channel-specific if/switch branches in business code.

import type { UserNotificationChannelConfig } from './notification-settings-repository';
import type { NotificationEvent } from './notification-types';

export type NotificationProviderConfigFieldType = 'text' | 'password' | 'url';

export interface NotificationProviderConfigField {
  key: string;
  type: NotificationProviderConfigFieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

export interface NotificationProviderConfigSchema {
  fields: NotificationProviderConfigField[];
}

export interface NotificationProvider {
  readonly type: string;
  send(
    event: NotificationEvent,
    channelConfig: UserNotificationChannelConfig,
  ): Promise<void>;
  test(channelConfig: UserNotificationChannelConfig): Promise<void>;
  validateConfig(config: unknown): Record<string, unknown>;
  getDisplayName(): string;
  getConfigSchema(): NotificationProviderConfigSchema;
  maskConfig?(config: Record<string, unknown>): Record<string, unknown>;
}
