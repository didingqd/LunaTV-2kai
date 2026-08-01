import { formatDateTime } from './time';
import type { UpdateDiffAnalysis } from './watching-update-notification-types';

export interface WatchingUpdateNotificationContent {
  title: string;
  content: string;
  displayTime: string;
}

export class WatchingUpdateNotificationBuilder {
  build(
    analysis: Pick<UpdateDiffAnalysis, 'newUpdates' | 'updatedHistory'>,
    checkedAt: number,
    timezone: string,
  ): WatchingUpdateNotificationContent | null {
    if (analysis.newUpdates.length === 0) return null;

    const sections = [
      '更新提醒',
      '',
      '【新更新】',
      '',
      ...analysis.newUpdates.map((item) =>
        this.formatEpisodeChange(item.title, item.fromEpisode, item.toEpisode),
      ),
    ];

    if (analysis.updatedHistory.length > 0) {
      sections.push(
        '',
        '【已更新】',
        '',
        ...analysis.updatedHistory.map((item) =>
          this.formatEpisodeChange(
            item.title,
            item.fromEpisode,
            item.toEpisode,
          ),
        ),
      );
    }

    const displayTime = formatDateTime(checkedAt, timezone);
    sections.push('', '检查时间：', displayTime);

    return {
      title: '更新提醒',
      content: sections.join('\n'),
      displayTime,
    };
  }

  private formatEpisodeChange(
    title: string,
    fromEpisode: number,
    toEpisode: number,
  ): string {
    return `${title}    ${fromEpisode}集 → ${toEpisode}集`;
  }
}

export const watchingUpdateNotificationBuilder =
  new WatchingUpdateNotificationBuilder();
