import {
  applyChannelContentTemplate,
  NOTIFICATION_TEMPLATE_CONFIG_KEY,
  notificationTemplateVariableRegistry,
} from './notification/notification-template';
import {
  buildWatchingUpdateTemplateResolver,
  createWatchingUpdateFoundPayload,
  DEFAULT_WATCHING_UPDATE_CONTENT_TEMPLATE,
  registerWatchingUpdateNotificationBuilder,
  WatchingUpdateNotificationBuilder,
  watchingUpdateNotificationBuilder,
} from './watching-update-notification-builder';

describe('WatchingUpdateNotificationBuilder', () => {
  const builder = new WatchingUpdateNotificationBuilder();
  const checkedAt = new Date('2026-08-01T10:30:00.000Z').getTime();

  it('builds a new update section with count and episode delta', () => {
    expect(
      builder.build(
        {
          newUpdates: [
            {
              followId: 'one-piece',
              title: '海贼王',
              fromEpisode: 12,
              toEpisode: 14,
            },
          ],
          updated: [],
        },
        checkedAt,
        'Asia/Shanghai',
      ),
    ).toEqual({
      title: '更新提醒',
      content: '更新提醒\n\n🆕 新更新（1）\n\n海贼王\n12 → 14 集（+2）',
      displayTime: '2026-08-01 18:30:00',
    });
  });

  it('sorts new updates by episode delta for display only', () => {
    const content = builder.build(
      {
        newUpdates: [
          {
            followId: 'b',
            title: 'B',
            fromEpisode: 20,
            toEpisode: 22,
          },
          {
            followId: 'a',
            title: 'A',
            fromEpisode: 10,
            toEpisode: 15,
          },
        ],
        updated: [],
      },
      checkedAt,
      'Asia/Shanghai',
    );

    expect(content).toEqual({
      title: '更新提醒',
      content:
        '更新提醒\n\n🆕 新更新（2）\n\nA\n10 → 15 集（+5）\n\nB\n20 → 22 集（+2）',
      displayTime: '2026-08-01 18:30:00',
    });
  });

  it('builds an updated section with count and episode delta', () => {
    expect(
      builder.build(
        {
          newUpdates: [],
          updated: [
            {
              followId: 'bleach',
              title: '死神',
              fromEpisode: 5,
              toEpisode: 8,
            },
          ],
        },
        checkedAt,
        'Asia/Shanghai',
      ),
    ).toEqual({
      title: '更新提醒',
      content: '更新提醒\n\n✅ 已更新（1）\n\n死神\n5 → 8 集（+3）',
      displayTime: '2026-08-01 18:30:00',
    });
  });

  it('does not render an empty updated section', () => {
    const content = builder.build(
      {
        newUpdates: [
          {
            followId: 'one-piece',
            title: '海贼王',
            fromEpisode: 12,
            toEpisode: 14,
          },
        ],
        updated: [],
      },
      checkedAt,
      'Asia/Shanghai',
    );

    expect(content?.content).not.toContain('已更新（0）');
    expect(content?.content).not.toContain('已更新');
  });

  it('does not render an empty new update section', () => {
    const content = builder.build(
      {
        newUpdates: [],
        updated: [
          {
            followId: 'bleach',
            title: '死神',
            fromEpisode: 5,
            toEpisode: 8,
          },
        ],
      },
      checkedAt,
      'Asia/Shanghai',
    );

    expect(content?.content).not.toContain('新更新（0）');
    expect(content?.content).not.toContain('新更新');
  });

  it('keeps payload time fields out of the notification body', () => {
    const message = builder.build(
      createWatchingUpdateFoundPayload({
        userId: 'alice',
        newUpdates: [
          {
            followId: 'one-piece',
            title: '海贼王',
            fromEpisode: 12,
            toEpisode: 14,
          },
        ],
        updated: [],
        checkedAt,
        timezone: 'Asia/Shanghai',
        displayTime: '2026-08-01 18:30:00',
      }),
    );

    expect(message).toMatchObject({
      title: '更新提醒',
      createdAt: checkedAt,
      payload: {
        checkedAt,
        timezone: 'Asia/Shanghai',
        displayTime: '2026-08-01 18:30:00',
      },
      metadata: {
        checkedAt,
        timezone: 'Asia/Shanghai',
        displayTime: '2026-08-01 18:30:00',
      },
    });
    expect(message.content).toContain('🆕 新更新（1）');
    expect(message.content).not.toContain('检查时间');
    expect(message.content).not.toContain('时间：');
    expect(message.content).not.toContain('2026-08-01');
  });

  it('does not build a notification when there are no update sections', () => {
    expect(
      builder.build(
        {
          newUpdates: [],
          updated: [],
        },
        0,
        'UTC',
      ),
    ).toBeNull();
  });

  // 修改点：新增用例 —— 验证推送消息中剧名后会用括号追加资源站名称
  it('appends the source name after the title in parentheses', () => {
    expect(
      builder.build(
        {
          newUpdates: [
            {
              followId: 'one-piece',
              title: '海贼王',
              fromEpisode: 12,
              toEpisode: 14,
              sourceName: '如意资源',
            },
          ],
          updated: [
            {
              followId: 'bleach',
              title: '死神',
              fromEpisode: 5,
              toEpisode: 8,
              sourceName: '电影天堂',
            },
          ],
        },
        checkedAt,
        'Asia/Shanghai',
      ),
    ).toEqual({
      title: '更新提醒',
      content:
        '更新提醒\n\n🆕 新更新（1）\n\n海贼王（如意资源）\n12 → 14 集（+2）\n\n✅ 已更新（1）\n\n死神（电影天堂）\n5 → 8 集（+3）',
      displayTime: '2026-08-01 18:30:00',
    });
  });

  // 修改点：新增用例 —— 验证无来源信息时保持原有消息格式
  it('keeps the original format when source name is missing', () => {
    expect(
      builder.build(
        {
          newUpdates: [
            {
              followId: 'one-piece',
              title: '海贼王',
              fromEpisode: 12,
              toEpisode: 14,
            },
          ],
          updated: [],
        },
        checkedAt,
        'Asia/Shanghai',
      ),
    ).toEqual({
      title: '更新提醒',
      content: '更新提醒\n\n🆕 新更新（1）\n\n海贼王\n12 → 14 集（+2）',
      displayTime: '2026-08-01 18:30:00',
    });
  });

  // 修改点：新增用例 —— 渠道配置自定义模板时按模板重渲染通知内容
  describe('channel content template', () => {
    beforeEach(() => {
      registerWatchingUpdateNotificationBuilder();
    });

    afterEach(() => {
      // 修改点：clear 后幂等 guard 仍在，beforeEach 的 register 不会重新注册，
      // 因此 afterEach 需要直接写回全局注册表，保证后续 describe 不受影响
      notificationTemplateVariableRegistry.register(
        'watching.update_found',
        buildWatchingUpdateTemplateResolver(),
      );
    });

    it('registers template variables for the watching update event', () => {
      const resolver = notificationTemplateVariableRegistry.get(
        'watching.update_found',
      );
      expect(resolver).not.toBeNull();
      expect(resolver?.defaultTemplate).toBe(
        DEFAULT_WATCHING_UPDATE_CONTENT_TEMPLATE,
      );
      const variableNames = resolver?.variables.map(
        (variable) => variable.name,
      );
      expect(variableNames).toEqual(
        expect.arrayContaining([
          'title',
          'newCount',
          'newUpdates',
          'updatedCount',
          'updated',
          'displayTime',
        ]),
      );
    });

    it('renders a custom template with counts, items and conditional blocks', () => {
      const message = watchingUpdateNotificationBuilder.build(
        createWatchingUpdateFoundPayload({
          userId: 'alice',
          newUpdates: [
            {
              followId: 'one-piece',
              title: '海贼王',
              fromEpisode: 12,
              toEpisode: 14,
              sourceName: '如意资源',
            },
          ],
          updated: [],
          checkedAt,
          timezone: 'Asia/Shanghai',
          displayTime: '2026-08-01 18:30:00',
        }),
      );

      // 修改点：自定义模板 —— 段落标题改为自由文字，数量与条目使用变量
      const customTemplate = [
        '{{title}}',
        '{{#newUpdates}}',
        '',
        '🔥 新番（{{newCount}}）',
        '',
        '{{newUpdates}}',
        '{{/newUpdates}}',
        '{{#updated}}',
        '',
        '📺 追更（{{updatedCount}}）',
        '',
        '{{updated}}',
        '{{/updated}}',
      ].join('\n');

      const result = applyChannelContentTemplate(message, {
        config: { [NOTIFICATION_TEMPLATE_CONFIG_KEY]: customTemplate },
      });

      expect(result).not.toBe(message);
      expect(result.content).toBe(
        '更新提醒\n\n🔥 新番（1）\n\n海贼王（如意资源）\n12 → 14 集（+2）',
      );
      expect(result.title).toBe('更新提醒');
    });

    it('resolves variables from the message payload', () => {
      const message = watchingUpdateNotificationBuilder.build(
        createWatchingUpdateFoundPayload({
          userId: 'alice',
          newUpdates: [
            {
              followId: 'one-piece',
              title: '海贼王',
              fromEpisode: 12,
              toEpisode: 14,
              sourceName: '如意资源',
            },
          ],
          updated: [
            {
              followId: 'bleach',
              title: '死神',
              fromEpisode: 5,
              toEpisode: 8,
              sourceName: '电影天堂',
            },
          ],
          checkedAt,
          timezone: 'Asia/Shanghai',
          displayTime: '2026-08-01 18:30:00',
        }),
      );

      const result = applyChannelContentTemplate(message, {
        config: {
          [NOTIFICATION_TEMPLATE_CONFIG_KEY]:
            '共 {{newCount}}+{{updatedCount}} 条（{{displayTime}}）',
        },
      });

      expect(result.content).toBe('共 1+1 条（2026-08-01 18:30:00）');
    });
  });
});
