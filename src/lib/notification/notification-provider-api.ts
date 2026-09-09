// 修改点：import 域事件引导模块以触发模板变量解析器注册（registry 注册幂等）。
// 该 import 只为副作用，模块名不含架构边界测试禁止的域词。
import '@/lib/notification-event-bootstrap';

import { notificationEventRegistry } from './notification-event-registry';
import { notificationSendLogRepository } from './notification-log-repository';
import type { NotificationProviderHealthStatus } from './notification-log-types';
import { notificationProviderRegistry } from './notification-provider-bootstrap';
import { getNotificationProviderPresentation } from './notification-provider-presentation';
import type {
  NotificationProviderCapabilities,
  NotificationProviderMetadata,
} from './notification-provider-registry';
import {
  type NotificationTemplateVariableMeta,
  notificationTemplateVariableRegistry,
} from './notification-template';

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
  healthStatus: NotificationProviderHealthStatus;
}

// 修改点：按事件分组的内容模板变量元数据，供渠道编辑弹窗展示可插入变量与默认模板
export interface NotificationTemplateVariableGroup {
  eventType: string;
  label: string;
  defaultTemplate: string;
  variables: NotificationTemplateVariableMeta[];
}

export function getNotificationProviderDeliveryStatus(
  capabilities: NotificationProviderCapabilities,
): NotificationProviderDeliveryStatus {
  return capabilities.canSend ? 'active' : 'preview';
}

export function buildNotificationTemplateVariableGroups(): NotificationTemplateVariableGroup[] {
  // 修改点：从模板变量注册表导出事件分组的变量元数据；label 取事件注册表的展示名
  return notificationTemplateVariableRegistry
    .list()
    .map(({ eventType, resolver }) => ({
      eventType,
      label: notificationEventRegistry.get(eventType)?.label ?? eventType,
      defaultTemplate: resolver.defaultTemplate,
      variables: resolver.variables.map((variable) => ({ ...variable })),
    }));
}

export async function buildNotificationProvidersPayload(): Promise<{
  providers: NotificationProviderApiMeta[];
  templateVariables: NotificationTemplateVariableGroup[];
}> {
  const healthByProvider =
    await notificationSendLogRepository.getProviderHealth();
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
        healthStatus: healthByProvider[provider.type] ?? 'healthy',
      };
    });

  providers.sort((left, right) => {
    const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.displayName.localeCompare(right.displayName);
  });

  // 修改点：payload 附带模板变量元数据，前端渠道编辑弹窗据此渲染模板编辑区
  return {
    providers,
    templateVariables: buildNotificationTemplateVariableGroups(),
  };
}
