import type { NotificationChannel } from '../notification-channel';
import type { NotificationMessage } from '../notification-types';

export interface WeChatWorkNotificationChannelConfig {
  webhookUrl?: unknown;
}

interface WeChatWorkResponse {
  errcode?: number;
  errmsg?: string;
}

function toMarkdownContent(message: NotificationMessage): string {
  const displayTime =
    typeof message.payload?.displayTime === 'string'
      ? message.payload.displayTime
      : '-';
  return [`### ${message.title}`, message.content, `时间：${displayTime}`].join(
    '\n',
  );
}

export class WeChatWorkNotificationChannel implements NotificationChannel {
  readonly name = 'wechat_work';

  constructor(
    private readonly config: WeChatWorkNotificationChannelConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    const webhookUrl =
      typeof this.config.webhookUrl === 'string'
        ? this.config.webhookUrl.trim()
        : '';
    if (!webhookUrl) throw new Error('WeChat Work webhook URL is required');

    const response = await this.fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: toMarkdownContent(message),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`WeChat Work webhook failed with ${response.status}`);
    }

    const data = (await response
      .json()
      .catch(() => ({}))) as WeChatWorkResponse;
    if (typeof data.errcode === 'number' && data.errcode !== 0) {
      throw new Error(data.errmsg || 'WeChat Work webhook failed');
    }
  }
}
