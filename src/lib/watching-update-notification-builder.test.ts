import {
  createWatchingUpdateFoundPayload,
  WatchingUpdateNotificationBuilder,
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
      content: '更新提醒\n\n新更新（1）\n\n海贼王\n12 → 14 集（+2）',
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
      content: '更新提醒\n\n新更新（2）\n\nA\n10 → 15 集（+5）\n\nB\n20 → 22 集（+2）',
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
      content: '更新提醒\n\n已更新（1）\n\n死神\n5 → 8 集（+3）',
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
    expect(message.content).toContain('新更新（1）');
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
});
