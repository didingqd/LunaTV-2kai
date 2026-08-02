import type { NotificationChannel } from '../notification-channel';
import type { NotificationMessage } from '../notification-types';
import { WATCHING_UPDATE_FOUND_EVENT_TYPE } from '../../watching-update-notification-events';

export interface WeChatWorkNotificationChannelConfig {
  webhookUrl?: unknown;
}

interface WeChatWorkResponse {
  errcode?: number;
  errmsg?: string;
}

interface ParsedWatchingUpdateItem {
  title: string;
  episodeLine: string;
}

interface ParsedWatchingUpdateSection {
  kind: 'new' | 'updated';
  heading: string;
  items: ParsedWatchingUpdateItem[];
}

function toMarkdownContent(message: NotificationMessage): string {
  const watchingUpdateMarkdown = toWatchingUpdateMarkdownContent(message);
  if (watchingUpdateMarkdown) return watchingUpdateMarkdown;

  const displayTime =
    typeof message.payload?.displayTime === 'string'
      ? message.payload.displayTime
      : '-';
  return [`### ${message.title}`, message.content, `时间：${displayTime}`].join(
    '\n',
  );
}

function toWatchingUpdateMarkdownContent(
  message: NotificationMessage,
): string | null {
  if (message.type !== WATCHING_UPDATE_FOUND_EVENT_TYPE) return null;

  const sections = parseWatchingUpdateSections(message);
  if (!sections || sections.length === 0) return null;

  const displayTime =
    typeof message.payload?.displayTime === 'string'
      ? message.payload.displayTime
      : '-';
  const lines = [`#  ${message.title}`, ''];

  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) lines.push('');
    lines.push(formatWatchingUpdateSectionHeading(section), '');

    section.items.forEach((item, itemIndex) => {
      if (itemIndex > 0) lines.push('');
      lines.push(...formatWatchingUpdateItem(item));
    });
  });

  lines.push('', `<font color="comment"> ${displayTime}</font>`);
  return lines.join('\n');
}

function parseWatchingUpdateSections(
  message: NotificationMessage,
): ParsedWatchingUpdateSection[] | null {
  const lines = message.content.split(/\r?\n/).map((line) => line.trimEnd());
  let index = skipBlankLines(lines, 0);

  if (lines[index]?.trim() !== message.title.trim()) return null;
  index += 1;

  const sections: ParsedWatchingUpdateSection[] = [];
  while (index < lines.length) {
    index = skipBlankLines(lines, index);
    if (lines[index]?.trim() === '----------------') {
      index += 1;
      continue;
    }

    const heading = lines[index]?.trim();
    const kind = getWatchingUpdateSectionKind(heading);
    if (!kind || !heading) return null;
    index += 1;
    index = skipBlankLines(lines, index);

    const items: ParsedWatchingUpdateItem[] = [];
    while (index < lines.length) {
      index = skipBlankLines(lines, index);
      const currentLine = lines[index]?.trim();
      if (!currentLine) break;
      if (
        currentLine === '----------------' ||
        getWatchingUpdateSectionKind(currentLine)
      ) {
        break;
      }

      const episodeLine = lines[index + 1]?.trim();
      if (!episodeLine || !isEpisodeLine(episodeLine)) return null;

      items.push({ title: currentLine, episodeLine });
      index += 2;
    }

    sections.push({ kind, heading, items });
  }

  return sections;
}

function skipBlankLines(lines: string[], startIndex: number): number {
  let index = startIndex;
  while (index < lines.length && lines[index].trim() === '') index += 1;
  return index;
}

function getWatchingUpdateSectionKind(
  heading: string | undefined,
): ParsedWatchingUpdateSection['kind'] | null {
  if (!heading) return null;
  const normalized = stripWatchingUpdateSectionIcon(heading);
  if (/^新更新（\d+）$/.test(normalized)) return 'new';
  if (/^已更新（\d+）$/.test(normalized)) return 'updated';
  return null;
}

function isEpisodeLine(line: string): boolean {
  return /^\d+ → \d+ 集（\+\d+）$/.test(line);
}

function formatWatchingUpdateSectionHeading(
  section: ParsedWatchingUpdateSection,
): string {
  const icon = section.kind === 'new' ? '🆕' : '✅';
  const heading = stripWatchingUpdateSectionIcon(section.heading);
  return `## <font color="info">${icon} ${heading}</font>`;
}

function formatWatchingUpdateItem(item: ParsedWatchingUpdateItem): string[] {
  return [`• ${item.title}`, `  ${item.episodeLine}`];
}

function stripWatchingUpdateSectionIcon(heading: string): string {
  return heading.replace(/^(?:🆕|✅)\s*/, '');
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
