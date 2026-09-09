// 通知内容模板引擎（域中立）：支持 {{变量}} 插值与 {{#变量}}...{{/变量}} 条件区块。
// 框架层不感知任何业务域的变量定义；具体事件的可插值变量由域侧通过
// notificationTemplateVariableRegistry 注册进来。

import type { NotificationMessage } from './notification-types';

// 渠道配置中存放自定义模板的 key（空值表示使用该事件的默认模板）
export const NOTIFICATION_TEMPLATE_CONFIG_KEY = 'contentTemplate';

// 自定义模板长度上限，防止异常输入撑爆存储与下游推送
export const MAX_NOTIFICATION_TEMPLATE_LENGTH = 2000;

export interface NotificationTemplateVariableMeta {
  name: string;
  description: string;
  sample: string;
  // 修改点：点击变量时插入编辑器的完整文本块；缺省为 {{name}}。
  // 列表类变量可提供含条件区块与标题行的完整段落，点击即填入整块。
  snippet?: string;
}

export interface NotificationTemplateResolver {
  variables: NotificationTemplateVariableMeta[];
  defaultTemplate: string;
  resolve(message: NotificationMessage): Record<string, string>;
  // 修改点：可选的测试样例消息构造器 —— 渠道"发送测试"时用它生成带样例数据的
  // 消息并按渠道模板渲染，使任意渠道的测试通知都能预览模板效果
  createTestMessage?: (userId: string) => NotificationMessage;
}

export interface NotificationTemplateDescriptor {
  eventType: string;
  label: string;
  defaultTemplate: string;
  variables: NotificationTemplateVariableMeta[];
}

// 条件区块语法：{{#name}} ... {{/name}}（不支持嵌套）
const CONDITION_BLOCK_PATTERN = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
// 插值语法：{{ name }} 或 {{name}}
const INTERPOLATION_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * 渲染通知模板：
 * 1. 条件区块 —— 变量值为空时整块删除（含标记本身）；非空时保留内部内容。
 * 2. 插值 —— 变量替换；未定义的变量替换为空字符串。
 * 3. 折叠 —— 3 个及以上连续换行压成 2 个（清理空区块留下的空洞）。
 * 4. 修剪 —— 去掉首尾空白。
 */
export function renderNotificationTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  // 修改点：先处理条件区块再插值，保证区块删除后残留的换行由折叠步骤统一清理
  const withoutBlocks = template.replace(
    CONDITION_BLOCK_PATTERN,
    (_match, name: string, inner: string) => {
      const value = variables[name] ?? '';
      return value ? inner : '';
    },
  );

  const interpolated = withoutBlocks.replace(
    INTERPOLATION_PATTERN,
    (_match, name: string) => variables[name] ?? '',
  );

  return interpolated.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}

export class NotificationTemplateVariableRegistry {
  private readonly resolvers = new Map<string, NotificationTemplateResolver>();

  // Map.set 语义：重复注册以最新为准，幂等不抛错
  register(eventType: string, resolver: NotificationTemplateResolver): void {
    const type = eventType.trim();
    if (!type) throw new Error('INVALID_NOTIFICATION_TEMPLATE_EVENT_TYPE');
    this.resolvers.set(type, resolver);
  }

  get(eventType: string): NotificationTemplateResolver | null {
    return this.resolvers.get(eventType) ?? null;
  }

  has(eventType: string): boolean {
    return this.resolvers.has(eventType);
  }

  list(): { eventType: string; resolver: NotificationTemplateResolver }[] {
    return Array.from(this.resolvers.entries()).map(
      ([eventType, resolver]) => ({ eventType, resolver }),
    );
  }

  clearForTests(): void {
    this.resolvers.clear();
  }
}

export const notificationTemplateVariableRegistry =
  new NotificationTemplateVariableRegistry();

/**
 * 按渠道配置渲染通知内容：渠道配置了自定义模板且该事件注册了变量解析器时
 * 重新渲染 content/body，否则原样返回（保持既有行为不变）。
 */
export function applyChannelContentTemplate<
  T extends NotificationMessage,
  C extends { config: Record<string, unknown> },
>(message: T, channel: C): T {
  const template = channel.config?.[NOTIFICATION_TEMPLATE_CONFIG_KEY];
  if (typeof template !== 'string' || !template.trim()) return message;

  const resolver = notificationTemplateVariableRegistry.get(message.type);
  if (!resolver) return message;

  const content = renderNotificationTemplate(
    template,
    resolver.resolve(message),
  );
  if (content === message.content) return message;

  // 修改点：仅重写 content 与 body，标题、时间等其余字段保持不变
  return { ...message, content, body: content };
}

/**
 * 从渠道配置中读取并校验自定义模板：
 * - 非字符串 / 空白视为未配置，返回空串；
 * - 超长视为非法配置。
 */
export function getValidatedNotificationTemplate(
  config: Record<string, unknown>,
): string {
  const value = config?.[NOTIFICATION_TEMPLATE_CONFIG_KEY];
  if (typeof value !== 'string') return '';
  const template = value.trim();
  if (template.length > MAX_NOTIFICATION_TEMPLATE_LENGTH) {
    throw new Error('INVALID_NOTIFICATION_CHANNEL_CONFIG');
  }
  return template;
}
