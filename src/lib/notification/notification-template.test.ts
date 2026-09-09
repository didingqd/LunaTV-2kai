import {
  applyChannelContentTemplate,
  getValidatedNotificationTemplate,
  MAX_NOTIFICATION_TEMPLATE_LENGTH,
  NOTIFICATION_TEMPLATE_CONFIG_KEY,
  notificationTemplateVariableRegistry,
  renderNotificationTemplate,
} from './notification-template';
import type { NotificationMessage } from './notification-types';

// 修改点：新增用例 —— 通知模板引擎（变量插值 / 条件区块 / 空行折叠 / 修剪）
describe('renderNotificationTemplate', () => {
  it('replaces variables and collapses extra blank lines', () => {
    expect(
      renderNotificationTemplate('标题：{{title}}\n\n\n\n尾行：{{tail}}', {
        title: '提醒',
        tail: '结束',
      }),
    ).toBe('标题：提醒\n\n尾行：结束');
  });

  it('replaces unknown variables with empty strings', () => {
    expect(renderNotificationTemplate('前{{missing}}后', { title: 'x' })).toBe(
      '前后',
    );
  });

  it('accepts whitespace inside interpolation markers', () => {
    expect(renderNotificationTemplate('{{ title }}', { title: '提醒' })).toBe(
      '提醒',
    );
  });

  it('keeps block content when variable is non-empty', () => {
    expect(
      renderNotificationTemplate('A{{#list}}\n内容 {{list}}\n{{/list}}B', {
        list: '有值',
      }),
    ).toBe('A\n内容 有值\nB');
  });

  it('removes the whole block when variable is empty', () => {
    expect(
      renderNotificationTemplate(
        'A\n\n{{#list}}\n标题（{{count}}）\n{{list}}\n{{/list}}\n\nB',
        { list: '', count: '0' },
      ),
    ).toBe('A\n\nB');
  });

  it('trims leading and trailing whitespace', () => {
    expect(
      renderNotificationTemplate('\n\n  {{title}}  \n\n', { title: '提醒' }),
    ).toBe('提醒');
  });

  it('renders the default update template identically to the legacy format', () => {
    // 修改点：默认模板四组合输出与原硬编码格式逐字一致（期望串取自
    // 追更通知构建器既有测试的断言）
    const defaultTemplate = [
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
    const item = (title: string, from: number, to: number) =>
      `${title}\n${from} → ${to} 集（+${to - from}）`;

    expect(
      renderNotificationTemplate(defaultTemplate, {
        title: '更新提醒',
        newCount: '1',
        newUpdates: item('海贼王', 12, 14),
        updatedCount: '0',
        updated: '',
      }),
    ).toBe('更新提醒\n\n🆕 新更新（1）\n\n海贼王\n12 → 14 集（+2）');

    expect(
      renderNotificationTemplate(defaultTemplate, {
        title: '更新提醒',
        newCount: '0',
        newUpdates: '',
        updatedCount: '1',
        updated: item('死神', 5, 8),
      }),
    ).toBe('更新提醒\n\n✅ 已更新（1）\n\n死神\n5 → 8 集（+3）');

    expect(renderTemplateWithBothSections(defaultTemplate, item)).toBe(
      '更新提醒\n\n🆕 新更新（1）\n\n海贼王\n12 → 14 集（+2）\n\n✅ 已更新（1）\n\n死神\n5 → 8 集（+3）',
    );
  });
});

function renderTemplateWithBothSections(
  template: string,
  item: (title: string, from: number, to: number) => string,
): string {
  return renderNotificationTemplate(template, {
    title: '更新提醒',
    newCount: '1',
    newUpdates: item('海贼王', 12, 14),
    updatedCount: '1',
    updated: item('死神', 5, 8),
  });
}

// 修改点：新增用例 —— 模板变量注册表
describe('notificationTemplateVariableRegistry', () => {
  it('registers and resolves variable resolvers by event type', () => {
    const registry =
      new (notificationTemplateVariableRegistry.constructor as new () => typeof notificationTemplateVariableRegistry)();
    registry.register('custom.event', {
      variables: [{ name: 'title', description: '标题', sample: '示例' }],
      defaultTemplate: '{{title}}',
      resolve: () => ({ title: '标题' }),
    });

    const resolver = registry.get('custom.event');
    expect(resolver?.defaultTemplate).toBe('{{title}}');
    expect(registry.has('custom.event')).toBe(true);
    expect(registry.has('other.event')).toBe(false);
    expect(registry.get('other.event')).toBeNull();

    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].eventType).toBe('custom.event');
  });

  it('re-registering the same event type overwrites idempotently', () => {
    const registry =
      new (notificationTemplateVariableRegistry.constructor as new () => typeof notificationTemplateVariableRegistry)();
    registry.register('custom.event', {
      variables: [],
      defaultTemplate: 'a',
      resolve: () => ({}),
    });
    registry.register('custom.event', {
      variables: [],
      defaultTemplate: 'b',
      resolve: () => ({}),
    });

    expect(registry.get('custom.event')?.defaultTemplate).toBe('b');
    expect(registry.list()).toHaveLength(1);
  });
});

function createMessage(
  overrides: Partial<NotificationMessage> = {},
): NotificationMessage {
  return {
    userId: 'alice',
    type: 'custom.event',
    title: '原始标题',
    body: '原始内容',
    content: '原始内容',
    createdAt: 1_000,
    payload: { displayTime: '2026-08-02 12:30:01' },
    ...overrides,
  };
}

// 修改点：新增用例 —— 按渠道配置渲染通知内容
describe('applyChannelContentTemplate', () => {
  afterEach(() => {
    notificationTemplateVariableRegistry.clearForTests();
  });

  it('returns the message unchanged when no template is configured', () => {
    const message = createMessage();
    const result = applyChannelContentTemplate(message, {
      config: { webhookUrl: 'https://example.com' },
    });
    expect(result).toBe(message);
  });

  it('returns the message unchanged when the event has no resolver', () => {
    const message = createMessage();
    const result = applyChannelContentTemplate(message, {
      config: { [NOTIFICATION_TEMPLATE_CONFIG_KEY]: '{{title}}' },
    });
    expect(result).toBe(message);
  });

  it('renders content and body from the channel template', () => {
    notificationTemplateVariableRegistry.register('custom.event', {
      variables: [],
      defaultTemplate: '{{title}}',
      resolve: (message) => ({
        title: message.title,
        time: String(message.payload?.displayTime ?? ''),
      }),
    });
    const message = createMessage();

    const result = applyChannelContentTemplate(message, {
      config: {
        [NOTIFICATION_TEMPLATE_CONFIG_KEY]: '【{{title}}】\n时间 {{time}}',
      },
    });

    expect(result).not.toBe(message);
    expect(result.content).toBe('【原始标题】\n时间 2026-08-02 12:30:01');
    expect(result.body).toBe(result.content);
    // 修改点：标题与其余字段不受模板影响
    expect(result.title).toBe('原始标题');
    expect(result.createdAt).toBe(message.createdAt);
    expect(result.userId).toBe(message.userId);
  });

  it('returns the message unchanged when rendered content is identical', () => {
    notificationTemplateVariableRegistry.register('custom.event', {
      variables: [],
      defaultTemplate: '{{content}}',
      resolve: (message) => ({ content: message.content }),
    });
    const message = createMessage();
    const result = applyChannelContentTemplate(message, {
      config: { [NOTIFICATION_TEMPLATE_CONFIG_KEY]: '{{content}}' },
    });
    expect(result).toBe(message);
  });
});

// 修改点：新增用例 —— 模板配置校验
describe('getValidatedNotificationTemplate', () => {
  it('returns empty string for non-string or blank values', () => {
    expect(getValidatedNotificationTemplate({})).toBe('');
    expect(
      getValidatedNotificationTemplate({
        [NOTIFICATION_TEMPLATE_CONFIG_KEY]: 123,
      }),
    ).toBe('');
    expect(
      getValidatedNotificationTemplate({
        [NOTIFICATION_TEMPLATE_CONFIG_KEY]: '   ',
      }),
    ).toBe('');
  });

  it('returns the trimmed template for valid values', () => {
    expect(
      getValidatedNotificationTemplate({
        [NOTIFICATION_TEMPLATE_CONFIG_KEY]: '  {{title}}  ',
      }),
    ).toBe('{{title}}');
  });

  it('rejects templates exceeding the length limit', () => {
    const longTemplate = 'a'.repeat(MAX_NOTIFICATION_TEMPLATE_LENGTH + 1);
    expect(() =>
      getValidatedNotificationTemplate({
        [NOTIFICATION_TEMPLATE_CONFIG_KEY]: longTemplate,
      }),
    ).toThrow('INVALID_NOTIFICATION_CHANNEL_CONFIG');
  });
});
