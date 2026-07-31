import type { NotificationChannel } from '../notification-channel';
import {
  NotificationMessageType,
  type NotificationMessage,
} from '../notification-types';

export interface WeChatWorkNotificationChannelConfig {
  webhookUrl?: unknown;
}

interface WeChatWorkResponse {
  errcode?: number;
  errmsg?: string;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getPayloadString(
  message: NotificationMessage,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = message.payload?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function toMarkdownContent(message: NotificationMessage): string {
  if (message.type === NotificationMessageType.WATCHING_UPDATE_FOUND) {
    return [
      '### 追更更新',
      `作品：${message.title}`,
      `内容：${message.content}`,
      `资源站：${getPayloadString(message, ['source', 'sourceName']) ?? '-'}`,
      `最新：${getPayloadString(message, ['episode', 'latestEpisode', 'newEpisode']) ?? '-'}`,
      `时间：${formatTime(message.createdAt)}`,
    ].join('\n');
  }

  if (message.type === NotificationMessageType.WATCHING_UPDATE_FAILED) {
    return [
      '### 追更失败',
      `任务：${message.title}`,
      `原因：${message.content}`,
      `时间：${formatTime(message.createdAt)}`,
    ].join('\n');
  }

  return [
    `### ${message.title}`,
    message.content,
    `时间：${formatTime(message.createdAt)}`,
  ].join('\n');
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

    const data = (await response.json().catch(() => ({}))) as WeChatWorkResponse;
    if (typeof data.errcode === 'number' && data.errcode !== 0) {
      throw new Error(data.errmsg || 'WeChat Work webhook failed');
    }
  }
}
