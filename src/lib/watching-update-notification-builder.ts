import {
  type NotificationBuilder,
  notificationBuilderRegistry,
} from './notification/notification-builder';
import { notificationEventRegistry } from './notification/notification-event-registry';
import {
  notificationTemplateVariableRegistry,
  renderNotificationTemplate,
} from './notification/notification-template';
import type {
  NotificationMessage,
  NotificationPayload,
} from './notification/notification-types';
import { formatDateTime } from './time';
import {
  WATCHING_UPDATE_FAILED_EVENT_TYPE,
  WATCHING_UPDATE_FOUND_EVENT_TYPE,
} from './watching-update-notification-events';
import type {
  UpdateDiffAnalysis,
  WatchingUpdateChange,
} from './watching-update-notification-types';

export {
  WATCHING_UPDATE_FAILED_EVENT_TYPE,
  WATCHING_UPDATE_FOUND_EVENT_TYPE,
} from './watching-update-notification-events';

export interface WatchingUpdateNotificationContent {
  title: string;
  content: string;
  displayTime: string;
}

export interface WatchingUpdateNotificationPayloadData {
  title: string;
  newUpdates: WatchingUpdateChange[];
  updated: WatchingUpdateChange[];
  checkedAt: number;
  timezone: string;
  displayTime: string;
}

export interface WatchingUpdateFailedNotificationPayloadData {
  title: string;
  message: string;
  error: string;
  source: string;
  displayTime: string;
  failedAt: number;
  resourceId?: string;
  taskSource?: string;
  taskId?: string;
  followId?: string;
}

export type WatchingUpdateNotificationPayload = NotificationPayload & {
  type: typeof WATCHING_UPDATE_FOUND_EVENT_TYPE;
  targetUser: string;
  data: WatchingUpdateNotificationPayloadData;
};

export type WatchingUpdateFailedNotificationPayload = NotificationPayload & {
  type: typeof WATCHING_UPDATE_FAILED_EVENT_TYPE;
  targetUser: string;
  data: WatchingUpdateFailedNotificationPayloadData;
};

// 修改点：追更通知的默认内容模板 —— 渲染结果与原硬编码格式逐字一致。
// 标题行（🆕 新更新 / ✅ 已更新）为模板文字可自由编辑；数量与剧集条目为变量；
// {{#newUpdates}}...{{/newUpdates}} 条件区块保证该类更新为空时整段（含标题行）不显示。
export const DEFAULT_WATCHING_UPDATE_CONTENT_TEMPLATE = [
  '{{title}}',
  '{{#newUpdates}}',
  '',
  '🆕 新更新（{{newCount}}）',
  '',
  '{{newUpdates}}',
  '{{/newUpdates}}',
  '{{#updated}}',
  '',
  '✅ 已更新（{{updatedCount}}）',
  '',
  '{{updated}}',
  '{{/updated}}',
].join('\n');

// 修改点：模板变量元数据（描述 + 示例值 + 点击插入的完整块），供通知渠道编辑弹窗展示与预览。
// 列表类变量（newUpdates / updated）的 snippet 是含标题行与条件区块的完整段落，点击即填入整块。
export const WATCHING_UPDATE_TEMPLATE_VARIABLES = [
  {
    name: 'title',
    description: '通知标题',
    sample: '更新提醒',
  },
  {
    name: 'newCount',
    description: '新更新的剧集数量',
    sample: '1',
  },
  {
    name: 'newUpdates',
    description: '新更新剧集的完整段落（标题 + 条目），点击填入整块',
    sample: '海贼王（如意资源）\n12 → 14 集（+2）',
    snippet: [
      '{{#newUpdates}}',
      '',
      '🆕 新更新（{{newCount}}）',
      '',
      '{{newUpdates}}',
      '{{/newUpdates}}',
    ].join('\n'),
  },
  {
    name: 'updatedCount',
    description: '已更新的剧集数量',
    sample: '2',
  },
  {
    name: 'updated',
    description: '已更新剧集的完整段落（标题 + 条目），点击填入整块',
    sample:
      '死神（电影天堂）\n5 → 8 集（+3）\n\n九门（极速资源）\n6 → 8 集（+2）',
    snippet: [
      '{{#updated}}',
      '',
      '✅ 已更新（{{updatedCount}}）',
      '',
      '{{updated}}',
      '{{/updated}}',
    ].join('\n'),
  },
  {
    name: 'displayTime',
    description: '检查时间（如 2026-08-02 12:30:01）',
    sample: '2026-08-02 12:30:01',
  },
] as const;

export function createWatchingUpdateFoundPayload(input: {
  userId: string;
  newUpdates: WatchingUpdateChange[];
  updated: WatchingUpdateChange[];
  checkedAt: number;
  timezone: string;
  displayTime: string;
}): WatchingUpdateNotificationPayload {
  return {
    type: WATCHING_UPDATE_FOUND_EVENT_TYPE,
    targetUser: input.userId,
    occurredAt: input.checkedAt,
    data: {
      title: '更新提醒',
      newUpdates: input.newUpdates,
      updated: input.updated,
      checkedAt: input.checkedAt,
      timezone: input.timezone,
      displayTime: input.displayTime,
    },
    metadata: {
      source: 'update-check',
      checkedAt: input.checkedAt,
      timezone: input.timezone,
      displayTime: input.displayTime,
    },
  };
}

export function createWatchingUpdateFailedPayload(input: {
  userId: string;
  title: string;
  message: string;
  error: string;
  source: string;
  timestamp: number;
  displayTime: string;
  metadata?: Record<string, unknown>;
}): WatchingUpdateFailedNotificationPayload {
  const metadata = input.metadata ?? {};
  return {
    type: WATCHING_UPDATE_FAILED_EVENT_TYPE,
    targetUser: input.userId,
    occurredAt: input.timestamp,
    data: {
      title: input.title,
      message: input.message,
      error: input.error,
      source: input.source,
      displayTime: input.displayTime,
      failedAt:
        typeof metadata.failedAt === 'number'
          ? metadata.failedAt
          : input.timestamp,
      resourceId:
        typeof metadata.resourceId === 'string'
          ? metadata.resourceId
          : undefined,
      taskSource:
        typeof metadata.taskSource === 'string'
          ? metadata.taskSource
          : undefined,
      taskId: typeof metadata.taskId === 'string' ? metadata.taskId : undefined,
      followId:
        typeof metadata.followId === 'string' ? metadata.followId : undefined,
    },
    metadata,
  };
}

function isWatchingUpdatePayload(
  value: unknown,
): value is WatchingUpdateNotificationPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as NotificationPayload).type === WATCHING_UPDATE_FOUND_EVENT_TYPE
  );
}

// 修改点：把单个剧集条目渲染成“剧名（资源站）\nfrom → to 集（+delta）”字符串
function renderWatchingUpdateItem(item: {
  title: string;
  fromEpisode: number;
  toEpisode: number;
  sourceName?: string;
}): string {
  // 剧名后用括号追加资源站名称（如“海贼王（如意资源）”），无来源信息时保持原格式
  const titleSuffix = item.sourceName ? `（${item.sourceName}）` : '';
  return `${item.title}${titleSuffix}\n${item.fromEpisode} → ${item.toEpisode} 集（+${episodeDelta(item)}）`;
}

// 修改点：把一组条目渲染为空行分隔的条目串（作为模板变量 newUpdates / updated 的值）
function renderWatchingUpdateItems(
  items: Array<{
    title: string;
    fromEpisode: number;
    toEpisode: number;
    sourceName?: string;
  }>,
): string {
  return items.map(renderWatchingUpdateItem).join('\n\n');
}

// 修改点：按默认模板 + 变量渲染追更通知内容（渲染结果与原硬编码格式逐字一致）
function renderWatchingUpdateContent(input: {
  title: string;
  newUpdates: WatchingUpdateChange[];
  updated: WatchingUpdateChange[];
  displayTime: string;
}): string {
  const sortedNewUpdates = sortNewUpdatesForDisplay(input.newUpdates);
  return renderNotificationTemplate(DEFAULT_WATCHING_UPDATE_CONTENT_TEMPLATE, {
    title: input.title,
    newCount: String(sortedNewUpdates.length),
    newUpdates: renderWatchingUpdateItems(sortedNewUpdates),
    updatedCount: String(input.updated.length),
    updated: renderWatchingUpdateItems(input.updated),
    displayTime: input.displayTime,
  });
}

export class WatchingUpdateNotificationBuilder implements NotificationBuilder<WatchingUpdateNotificationPayload> {
  build(payload: WatchingUpdateNotificationPayload): NotificationMessage;
  build(
    analysis: Pick<UpdateDiffAnalysis, 'newUpdates' | 'updated'>,
    checkedAt: number,
    timezone: string,
  ): WatchingUpdateNotificationContent | null;
  build(
    payloadOrAnalysis:
      | WatchingUpdateNotificationPayload
      | Pick<UpdateDiffAnalysis, 'newUpdates' | 'updated'>,
    checkedAt?: number,
    timezone?: string,
  ): NotificationMessage | WatchingUpdateNotificationContent | null {
    if (isWatchingUpdatePayload(payloadOrAnalysis)) {
      const content = this.buildContent(
        {
          newUpdates: payloadOrAnalysis.data.newUpdates,
          updated: payloadOrAnalysis.data.updated,
        },
        payloadOrAnalysis.data.checkedAt,
        payloadOrAnalysis.data.timezone,
        payloadOrAnalysis.data.displayTime,
      );
      if (!content) {
        return {
          userId: payloadOrAnalysis.targetUser,
          type: payloadOrAnalysis.type,
          title: payloadOrAnalysis.data.title,
          body: '',
          content: '',
          createdAt: payloadOrAnalysis.data.checkedAt,
          payload: { ...payloadOrAnalysis.data },
          metadata: payloadOrAnalysis.metadata,
        };
      }
      return {
        userId: payloadOrAnalysis.targetUser,
        type: payloadOrAnalysis.type,
        title: content.title,
        body: content.content,
        content: content.content,
        level: 'success',
        createdAt: payloadOrAnalysis.data.checkedAt,
        payload: {
          ...payloadOrAnalysis.data,
          eventType: payloadOrAnalysis.type,
        },
        metadata: payloadOrAnalysis.metadata,
      };
    }

    if (checkedAt === undefined || timezone === undefined) {
      throw new Error('INVALID_WATCHING_UPDATE_NOTIFICATION_INPUT');
    }
    return this.buildContent(payloadOrAnalysis, checkedAt, timezone);
  }

  private buildContent(
    analysis: Pick<UpdateDiffAnalysis, 'newUpdates' | 'updated'>,
    checkedAt: number,
    timezone: string,
    displayTime = formatDateTime(checkedAt, timezone),
  ): WatchingUpdateNotificationContent | null {
    if (analysis.newUpdates.length === 0 && analysis.updated.length === 0) {
      return null;
    }

    // 修改点：内容改由默认模板渲染（标题行字面文字 + 数量/条目变量），输出与原格式逐字一致
    const content = renderWatchingUpdateContent({
      title: '更新提醒',
      newUpdates: analysis.newUpdates,
      updated: analysis.updated,
      displayTime,
    });

    return {
      title: '更新提醒',
      content,
      displayTime,
    };
  }
}

// 修改点：区块标题行（🆕 新更新（N）等）改由默认模板的字面文字渲染，
// 原 formatWatchingUpdateSectionHeading 已随之移除

function episodeDelta(item: {
  fromEpisode: number;
  toEpisode: number;
}): number {
  return Math.max(0, item.toEpisode - item.fromEpisode);
}

function sortNewUpdatesForDisplay<
  T extends {
    title: string;
    fromEpisode: number;
    toEpisode: number;
  },
>(items: T[]): T[] {
  return [...items].sort(
    (left, right) =>
      episodeDelta(right) - episodeDelta(left) ||
      displayTimestamp(right) - displayTimestamp(left) ||
      compareDisplayTitle(left, right),
  );
}

function displayTimestamp(item: object): number {
  const value = (item as { detectedAt?: unknown; updatedAt?: unknown })
    .detectedAt;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const updatedAt = (item as { updatedAt?: unknown }).updatedAt;
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  if (typeof updatedAt === 'string') {
    const timestamp = Date.parse(updatedAt);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return 0;
}

function compareDisplayTitle(
  left: { title: string },
  right: { title: string },
): number {
  return left.title.localeCompare(right.title, 'zh-CN');
}

// 修改点：从消息 payload 提取数据并生成模板变量值（供渠道自定义模板渲染使用）
function resolveWatchingUpdateTemplateVariables(
  message: NotificationMessage,
): Record<string, string> {
  const payload = (message.payload ?? {}) as Record<string, unknown>;
  const newUpdates = Array.isArray(payload.newUpdates)
    ? payload.newUpdates.filter(isWatchingUpdateChange)
    : [];
  const updated = Array.isArray(payload.updated)
    ? payload.updated.filter(isWatchingUpdateChange)
    : [];
  const displayTime =
    typeof payload.displayTime === 'string' ? payload.displayTime : '';

  const sortedNewUpdates = sortNewUpdatesForDisplay(newUpdates);
  return {
    title: message.title,
    newCount: String(sortedNewUpdates.length),
    newUpdates: renderWatchingUpdateItems(sortedNewUpdates),
    updatedCount: String(updated.length),
    updated: renderWatchingUpdateItems(updated),
    displayTime,
  };
}

function isWatchingUpdateChange(value: unknown): value is WatchingUpdateChange {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.title === 'string' &&
    typeof item.fromEpisode === 'number' &&
    typeof item.toEpisode === 'number'
  );
}

// 修改点：导出 resolver 构造函数，注册与测试/二次注册共用同一份定义
export function buildWatchingUpdateTemplateResolver() {
  return {
    variables: WATCHING_UPDATE_TEMPLATE_VARIABLES.map((variable) => ({
      ...variable,
    })),
    defaultTemplate: DEFAULT_WATCHING_UPDATE_CONTENT_TEMPLATE,
    resolve: resolveWatchingUpdateTemplateVariables,
  };
}

export const watchingUpdateNotificationBuilder =
  new WatchingUpdateNotificationBuilder();

let watchingUpdateNotificationBuilderRegistered = false;

export function registerWatchingUpdateNotificationBuilder(): void {
  if (watchingUpdateNotificationBuilderRegistered) return;
  notificationEventRegistry.registerMany([
    {
      type: WATCHING_UPDATE_FOUND_EVENT_TYPE,
      label: '追更更新',
      description: '关注的影视内容发现新集或新季时通知。',
      category: 'watching',
      defaultSubscribed: true,
    },
    {
      type: WATCHING_UPDATE_FAILED_EVENT_TYPE,
      label: '更新失败',
      description: '追更检查或更新过程失败时通知。',
      category: 'watching',
      defaultSubscribed: true,
    },
  ]);
  notificationBuilderRegistry.register(
    WATCHING_UPDATE_FOUND_EVENT_TYPE,
    watchingUpdateNotificationBuilder,
  );
  // 修改点：同步注册模板变量解析器，通知渠道编辑的自定义模板按此渲染内容
  notificationTemplateVariableRegistry.register(
    WATCHING_UPDATE_FOUND_EVENT_TYPE,
    buildWatchingUpdateTemplateResolver(),
  );
  watchingUpdateNotificationBuilderRegistered = true;
}
