import { WatchingUpdateNotificationBuilder } from './watching-update-notification-builder';

describe('WatchingUpdateNotificationBuilder', () => {
  const builder = new WatchingUpdateNotificationBuilder();

  it('builds one summary with new updates, existing history, and user timezone', () => {
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
          updatedHistory: [
            {
              followId: 'one-piece',
              title: '海贼王',
              fromEpisode: 12,
              toEpisode: 13,
              updatedAt: '2026-07-31T12:00:00.000Z',
            },
          ],
        },
        new Date('2026-07-31T13:30:00.000Z').getTime(),
        'Asia/Shanghai',
      ),
    ).toEqual({
      title: '更新提醒',
      content:
        '更新提醒\n\n【新更新】\n\n火影忍者    12集 → 14集\n\n【已更新】\n\n海贼王    12集 → 13集\n\n检查时间：\n2026-07-31 21:30',
    });
  });

  it('does not build a notification when no new update exists', () => {
    expect(
      builder.build(
        {
          newUpdates: [],
          updatedHistory: [],
        },
        0,
        'UTC',
      ),
    ).toBeNull();
  });
});
