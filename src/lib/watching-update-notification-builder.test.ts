import { WatchingUpdateNotificationBuilder } from './watching-update-notification-builder';

describe('WatchingUpdateNotificationBuilder', () => {
  const builder = new WatchingUpdateNotificationBuilder();

  it('builds one summary with new updates, updated items, and user timezone', () => {
    expect(
      builder.build(
        {
          newUpdates: [
            {
              followId: 'naruto',
              title: '火影忍者',
              fromEpisode: 12,
              toEpisode: 14,
            },
          ],
          updated: [
            {
              followId: 'one-piece',
              title: '海贼王',
              fromEpisode: 12,
              toEpisode: 13,
            },
          ],
        },
        new Date('2026-07-31T13:30:00.000Z').getTime(),
        'Asia/Shanghai',
      ),
    ).toEqual({
      title: '更新提醒',
      content:
        '更新提醒\n\n【新更新】\n\n火影忍者\n12集 → 14集\n\n【已更新】\n\n海贼王\n12集 → 13集\n\n检查时间：\n2026-07-31 21:30:00',
      displayTime: '2026-07-31 21:30:00',
    });
  });

  it('formats display time with the configured scheduler timezone', () => {
    const analysis = {
      newUpdates: [
        {
          followId: 'demo',
          title: 'Demo Show',
          fromEpisode: 1,
          toEpisode: 2,
        },
      ],
      updated: [],
    };
    const checkedAt = new Date('2026-08-01T01:00:00.000Z').getTime();

    expect(builder.build(analysis, checkedAt, 'Asia/Shanghai')).toMatchObject({
      displayTime: '2026-08-01 09:00:00',
      content: expect.stringContaining('检查时间：\n2026-08-01 09:00:00'),
    });
    expect(
      builder.build(analysis, checkedAt, 'America/New_York'),
    ).toMatchObject({
      displayTime: '2026-07-31 21:00:00',
      content: expect.stringContaining('检查时间：\n2026-07-31 21:00:00'),
    });
  });

  it('does not build a notification when no new update exists', () => {
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
