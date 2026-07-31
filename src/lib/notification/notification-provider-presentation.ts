export interface NotificationProviderPresentation {
  displayName: string;
  description: string;
  icon: string;
  group?: string;
  sortOrder?: number;
}

/**
 * Presentation metadata deliberately owns only API/UI display hints. Provider
 * availability, schemas, validation, testing and send capability stay
 * authoritative in NotificationProviderRegistry and concrete providers.
 */
export const NOTIFICATION_PROVIDER_PRESENTATIONS: Record<
  string,
  NotificationProviderPresentation
> = {
  inbox: {
    displayName: '\u7ad9\u5185\u901a\u77e5',
    description:
      '\u5728 LunaTV \u7ad9\u5185\u901a\u77e5\u4e2d\u5fc3\u63a5\u6536\u6d88\u606f\u3002',
    group: '\u5b98\u65b9',
    icon: 'inbox',
    sortOrder: 10,
  },
  wechat_work: {
    displayName: '\u4f01\u4e1a\u5fae\u4fe1',
    description:
      '\u53d1\u9001\u901a\u77e5\u5230\u4f01\u4e1a\u5fae\u4fe1\u7fa4\u673a\u5668\u4eba\u3002',
    group: '\u5b98\u65b9',
    icon: 'building-2',
    sortOrder: 20,
  },
  webhook: {
    displayName: 'Webhook',
    description: 'HTTP POST \u63a8\u9001\u3002',
    group: 'Webhook',
    icon: 'link',
    sortOrder: 100,
  },
  telegram: {
    displayName: 'Telegram',
    description: 'Telegram Bot \u63a8\u9001\u3002',
    group: '\u4f01\u4e1a\u6d88\u606f',
    icon: 'send',
    sortOrder: 200,
  },
  bark: {
    displayName: 'Bark',
    description: 'Bark iOS \u63a8\u9001\u3002',
    group: '\u79fb\u52a8\u63a8\u9001',
    icon: 'smartphone',
    sortOrder: 300,
  },
  pushplus: {
    displayName: 'PushPlus',
    description: 'PushPlus \u63a8\u9001\u3002',
    group: '\u79fb\u52a8\u63a8\u9001',
    icon: 'message-circle',
    sortOrder: 310,
  },
  serverchan3: {
    displayName: 'Server\u9171',
    description: 'Server\u9171 Turbo \u63a8\u9001\u3002',
    group: '\u79fb\u52a8\u63a8\u9001',
    icon: 'bell-ring',
    sortOrder: 320,
  },
  dingtalk: {
    displayName: '\u9489\u9489',
    description: '\u9489\u9489\u7fa4\u673a\u5668\u4eba\u63a8\u9001\u3002',
    group: '\u4f01\u4e1a\u6d88\u606f',
    icon: 'bot',
    sortOrder: 210,
  },
  lark: {
    displayName: '\u98de\u4e66',
    description: '\u98de\u4e66\u7fa4\u673a\u5668\u4eba\u63a8\u9001\u3002',
    group: '\u4f01\u4e1a\u6d88\u606f',
    icon: 'message-square',
    sortOrder: 220,
  },
  wecom: {
    displayName: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba',
    description:
      '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba Key \u63a8\u9001\u3002',
    group: '\u4f01\u4e1a\u6d88\u606f',
    icon: 'building-2',
    sortOrder: 230,
  },
  notifyx: {
    displayName: 'NotifyX',
    description: 'NotifyX \u805a\u5408\u63a8\u9001\u3002',
    group: '\u79fb\u52a8\u63a8\u9001',
    icon: 'bell',
    sortOrder: 330,
  },
  resend: {
    displayName: 'Email',
    description: '\u90ae\u4ef6\u901a\u77e5\u3002',
    group: '\u90ae\u4ef6',
    icon: 'mail',
    sortOrder: 400,
  },
  gotify: {
    displayName: 'Gotify',
    description: 'Gotify \u81ea\u6258\u7ba1\u63a8\u9001\u3002',
    group: '\u81ea\u5efa\u670d\u52a1',
    icon: 'bell',
    sortOrder: 500,
  },
  ntfy: {
    displayName: 'ntfy',
    description: 'ntfy \u4e3b\u9898\u63a8\u9001\u3002',
    group: '\u81ea\u5efa\u670d\u52a1',
    icon: 'radio',
    sortOrder: 510,
  },
};

const unknownProviderPresentation: NotificationProviderPresentation = {
  displayName: '\u901a\u77e5\u6e20\u9053',
  description:
    '\u6b64\u901a\u77e5\u6e20\u9053\u6682\u672a\u63d0\u4f9b\u989d\u5916\u5c55\u793a\u4fe1\u606f\u3002',
  icon: 'bell',
};

export function getNotificationProviderPresentation(
  type: string,
): NotificationProviderPresentation {
  return (
    NOTIFICATION_PROVIDER_PRESENTATIONS[type] ?? unknownProviderPresentation
  );
}

export function listNotificationProviderPresentationTypes(): string[] {
  return Object.keys(NOTIFICATION_PROVIDER_PRESENTATIONS);
}
